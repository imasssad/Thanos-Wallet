import { initSentry, captureException } from './lib/sentry.js';
initSentry('thanos-indexer');

import cors from 'cors';
import express from 'express';
import {
  buildSeedActivity,
  ensureSchema,
  getBalancesFor,
  getMakaluSeedTokenList,
  getNativeLithoBalance,
  runMakaluSync,
  seededApprovals,
  startBackgroundSync,
} from './lep100-sync.js';
import { metricsHandler, metricsMiddleware } from './lib/metrics.js';

const app = express();
app.use(metricsMiddleware);
app.get('/metrics', metricsHandler);

/* CORS allowlist — previously a wildcard. In production the indexer is
 * reverse-proxied same-origin at /indexer so browsers never need CORS at
 * all; the allowlist only matters for dev setups hitting the port
 * directly. Comma-separated CORS_ORIGINS env (same convention as the
 * API), defaulting to localhost dev hosts. */
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
}));
app.use(express.json());

const now = () => new Date().toISOString();

app.get('/health', (_req, res) => res.json({ ok: true, service: 'wallet-indexer' }));

/* ─── Portfolio (joins native LITHO + LEP100 balances) ─────────────── */

app.get('/portfolio/:walletAddress', async (req, res) => {
  const walletAddress = req.params.walletAddress;
  try {
    const [native, lep100, activity] = await Promise.all([
      getNativeLithoBalance(walletAddress).catch(() => '0'),
      getBalancesFor(walletAddress),
      buildSeedActivity(walletAddress),
    ]);
    res.json({
      walletAddress,
      updatedAt: now(),
      assets: [
        {
          chainId: 700777,
          symbol: 'LITHO',
          name: 'Lithosphere',
          decimals: 18,
          balance: native,
          native: true,
        },
        ...lep100,
      ],
      activity,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/activity/:walletAddress', async (req, res) => {
  try {
    const items = await buildSeedActivity(req.params.walletAddress);
    res.json({ walletAddress: req.params.walletAddress, items });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ─── LEP-100 endpoints (real now) ─────────────────────────────────── */

app.get('/lep100/spec', (_req, res) => {
  res.json({
    standard: 'lep100',
    // Honesty: only the chains this indexer ACTUALLY syncs. Kamet
    // (900523) was advertised here for months with zero Kamet sync
    // behind it — re-add it together with a real Kamet sync loop.
    chainIds: [700777],
    tables: ['lep100_tokens', 'lep100_balances', 'lep100_allowances', 'lep100_events', 'lep100_sync_jobs'],
    eventNames: ['Transfer', 'Approval'],
    notes: [
      'Real eth_getLogs Transfer-event sync against rpc-2.litho.ai',
      'Token list from MAKALU_LEP100_*_ADDRESS env vars',
      'Block cursor persisted in lep100_sync_jobs',
    ],
  });
});

app.get('/lep100/tokens', async (req, res) => {
  const chainId = Number(req.query.chainId || 700777);
  try {
    const seeded = await getMakaluSeedTokenList();
    res.json({ ...seeded, chainId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/lep100/balances/:walletAddress', async (req, res) => {
  try {
    const items = await getBalancesFor(req.params.walletAddress);
    res.json({ walletAddress: req.params.walletAddress, items });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/lep100/activity/:walletAddress', async (req, res) => {
  try {
    const items = await buildSeedActivity(req.params.walletAddress);
    res.json({ walletAddress: req.params.walletAddress, items });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/lep100/approvals/:walletAddress', (req, res) => {
  // Approval indexing is a follow-up — return empty list for now so the
  // contract is stable, schema is in place.
  res.json({ walletAddress: req.params.walletAddress, items: seededApprovals });
});

/* ─── Manual sync trigger (also fired automatically by the bg loop) ─── */

app.post('/lep100/sync', async (req, res) => {
  /* Optional bearer guard — the audit flagged this endpoint as
   * unauthenticated + unthrottled. A backfill rescans ~6M blocks, so an
   * internet-reachable deployment shouldn't let strangers trigger it.
   * Set INDEXER_SYNC_TOKEN to require `Authorization: Bearer <token>`;
   * unset keeps the open behaviour for localhost/dev (production hits
   * it via the VPS loopback, not the public proxy). */
  const required = process.env.INDEXER_SYNC_TOKEN;
  if (required) {
    const got = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (got !== required) {
      res.status(401).json({ error: 'invalid or missing sync token' });
      return;
    }
  }
  const mode = (req.body?.mode || 'incremental') as 'bootstrap' | 'incremental' | 'backfill';
  try {
    const result = await runMakaluSync(mode);
    res.json(result);
  } catch (err) {
    captureException(err, { route: '/lep100/sync', mode });
    res.status(500).json({ error: (err as Error).message });
  }
});

/* ─── Last-resort error handler — catches anything else, ships to Sentry. */
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  captureException(err, { route: req.originalUrl, method: req.method });
  res.status(500).json({ error: err.message || 'Internal server error' });
});

process.on('uncaughtException',  err => { captureException(err); });
process.on('unhandledRejection', err => { captureException(err); });

/* ─── Boot ─────────────────────────────────────────────────────────── */

const port = Number(process.env.PORT || 4010);

async function boot() {
  if (process.env.DATABASE_URL) {
    try {
      await ensureSchema();
      console.log('[indexer] schema ready');
      // Background sync only fires when DB is connected.
      startBackgroundSync();
    } catch (err) {
      console.error('[indexer] DB boot failed — running with degraded mock responses:', (err as Error).message);
    }
  } else {
    console.warn('[indexer] DATABASE_URL not set — HTTP server only, no DB');
  }
  app.listen(port, () => console.log(`wallet-indexer listening on ${port}`));
}

boot();
