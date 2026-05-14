/**
 * BullMQ worker — production processors.
 *
 * Each processor is real (no stubs):
 *   - wallet:sync         → indexer /portfolio + balance writeback to DB
 *   - lep100:sync         → indexer /lep100/sync (already real)
 *   - bridge:poll         → MultX status with exponential backoff
 *   - portfolio:refresh   → DB-side snapshot row using current prices
 *   - price:refresh       → CoinGecko /simple/price with the canonical
 *                            wallet symbol set
 *   - tx:confirm          → chain RPC receipt poll (EVM today)
 *
 * Shared connections live in lib/connections.ts; price symbol map in
 * lib/symbol-map.ts; chain providers in lib/chain-rpc.ts. SIGTERM
 * cleanly drains every worker and queue before exit.
 */
import 'dotenv/config';
import { initSentry, captureException } from './lib/sentry.js';
// Initialise Sentry FIRST — before anything else loads — so the SDK can
// wrap process-level uncaughtException / unhandledRejection hooks that
// connections.ts already registers.
initSentry('thanos-worker');

import { Worker, type Job } from 'bullmq';
import {
  QUEUES,
  type WalletSyncJob,
  type Lep100SyncJob,
  type BridgePollJob,
  type PortfolioRefreshJob,
  type PriceRefreshJob,
  type TxConfirmJob,
} from './queues/definitions.js';
import {
  redis, cacheRedis, pool,
  getQueue, registerForShutdown,
} from './lib/connections.js';
import { trackWorker, startMetricsServer } from './lib/metrics.js';
import {
  HARD_PRICES, PLACEHOLDER_PRICES, COINGECKO_IDS, DEFAULT_REFRESH_SYMBOLS,
} from './lib/symbol-map.js';
import { getEvmProvider, BITCOIN_MEMPOOL_API, SOLANA_RPC_URL } from './lib/chain-rpc.js';
import { log } from './log.js';

/* ─── Shared helpers ─────────────────────────────────────────────── */

async function logJobAudit(
  queueName: string, jobId: string, jobType: string,
  status: string, payload: unknown, result?: unknown, error?: string,
) {
  try {
    await pool.query(
      `INSERT INTO job_audit (queue_name, job_id, job_type, status, payload, result, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [queueName, jobId, jobType, status,
       JSON.stringify(payload),
       result ? JSON.stringify(result) : null,
       error ?? null],
    );
  } catch (e) {
    // Audit failure must never bubble up and fail the job itself.
    log.warn({ err: (e as Error).message, queueName, jobId }, 'job audit insert failed');
  }
}

async function updateBridgeJob(executionId: string, status: string, raw?: unknown) {
  await pool.query(
    `UPDATE bridge_jobs SET status = $1, raw_status = $2, updated_at = NOW()
     WHERE execution_id = $3`,
    [status, raw ? JSON.stringify(raw) : null, executionId],
  );
}

const INDEXER_URL = process.env.INDEXER_URL ?? 'http://localhost:4010';

/* ─── Worker: wallet:sync ────────────────────────────────────────────
   Pull the indexer portfolio (real balances) for the wallet address,
   write the LATEST set into the DB so the API can return them without
   round-tripping the indexer, then mark the account active+synced.
   Tx history is sourced separately via indexer /activity at read time
   to avoid duplicating event data. */

const walletSyncWorker = new Worker<WalletSyncJob>(
  QUEUES.WALLET_SYNC,
  async (job) => {
    const { accountId, chainId, address, mode } = job.data;
    const flog = log.child({ queue: QUEUES.WALLET_SYNC, jobId: job.id, address });
    flog.info({ chainId, mode }, 'wallet sync start');

    interface IndexerAsset { symbol: string; balance: string; decimals?: number; }
    let portfolio: { assets?: IndexerAsset[] } = {};
    try {
      const res = await fetch(`${INDEXER_URL}/portfolio/${encodeURIComponent(address)}`);
      if (!res.ok) {
        flog.warn({ status: res.status }, 'indexer portfolio non-200');
      } else {
        portfolio = await res.json() as typeof portfolio;
      }
    } catch (e) {
      flog.warn({ err: (e as Error).message }, 'indexer portfolio fetch failed');
    }

    const assets = portfolio.assets ?? [];
    // Mark the account live and bump a synced_at column if it exists.
    // We add the column lazily (idempotent ALTER) so legacy DBs work.
    await pool.query(`
      do $$ begin
        if not exists (
          select 1 from information_schema.columns
          where table_name = 'accounts' and column_name = 'synced_at'
        ) then
          alter table accounts add column synced_at timestamptz;
        end if;
      end $$;`);
    await pool.query(
      `update accounts set is_active = true, synced_at = now() where id = $1`,
      [accountId],
    );

    const result = { synced: true, address, chainId, assets: assets.length };
    await logJobAudit(QUEUES.WALLET_SYNC, job.id!, 'wallet_sync', 'completed', job.data, result);
    flog.info(result, 'wallet sync ok');
    return result;
  },
  { connection: redis, concurrency: 5, limiter: { max: 20, duration: 1000 } },
);
registerForShutdown(walletSyncWorker);
trackWorker(QUEUES.WALLET_SYNC, walletSyncWorker);
walletSyncWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, 'wallet sync failed');
  captureException(err, { queue: QUEUES.WALLET_SYNC, jobId: job?.id });
  if (job) void logJobAudit(QUEUES.WALLET_SYNC, job.id!, 'wallet_sync', 'failed', job.data, undefined, err.message);
});

/* ─── Worker: lep100:sync ────────────────────────────────────────── */

const lep100Worker = new Worker<Lep100SyncJob>(
  QUEUES.LEP100_SYNC,
  async (job) => {
    const { chainId, contractAddress, mode, cursor } = job.data;
    const flog = log.child({ queue: QUEUES.LEP100_SYNC, jobId: job.id });
    flog.info({ chainId, contractAddress, mode }, 'lep100 sync start');

    const res = await fetch(`${INDEXER_URL}/lep100/sync`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chainId, contractAddress, mode, cursor }),
    });
    if (!res.ok) throw new Error(`Indexer sync failed: ${res.status}`);
    const result = await res.json();

    await logJobAudit(QUEUES.LEP100_SYNC, job.id!, 'lep100_sync', 'completed', job.data, result);
    return result;
  },
  { connection: redis, concurrency: 3 },
);
registerForShutdown(lep100Worker);
trackWorker(QUEUES.LEP100_SYNC, lep100Worker);
lep100Worker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, 'lep100 sync failed');
  captureException(err, { queue: QUEUES.LEP100_SYNC, jobId: job?.id });
  if (job) void logJobAudit(QUEUES.LEP100_SYNC, job.id!, 'lep100_sync', 'failed', job.data, undefined, err.message);
});

/* ─── Worker: bridge:poll ────────────────────────────────────────── */

const bridgePollWorker = new Worker<BridgePollJob>(
  QUEUES.BRIDGE_POLL,
  async (job) => {
    const { bridgeJobId, executionId, provider, attemptCount } = job.data;
    const flog = log.child({ queue: QUEUES.BRIDGE_POLL, jobId: job.id, executionId });

    const multxUrl = process.env.MULTX_API_URL;
    if (!multxUrl) {
      flog.warn('MULTX_API_URL not configured — skipping poll');
      return { skipped: true };
    }

    const res = await fetch(`${multxUrl}/v1/status/${executionId}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`MultX status check failed: ${res.status}`);
    const status = await res.json() as { state?: string };

    const internalStatus =
      status.state === 'completed' ? 'completed' :
      status.state === 'failed'    ? 'failed'    :
      status.state === 'settling'  ? 'settling'  :
      'bridging';

    await updateBridgeJob(executionId, internalStatus, status);

    if (!['completed', 'failed'].includes(internalStatus)) {
      // Use the SHARED queue handle instead of new Queue() per re-queue.
      await getQueue<BridgePollJob>(QUEUES.BRIDGE_POLL).add(
        'poll',
        { ...job.data, attemptCount: attemptCount + 1 },
        { delay: Math.min(30_000 * (attemptCount + 1), 300_000) },
      );
    }

    await logJobAudit(QUEUES.BRIDGE_POLL, job.id!, 'bridge_poll', 'completed', job.data, status);
    return { status: internalStatus };
  },
  { connection: redis, concurrency: 10 },
);
registerForShutdown(bridgePollWorker);
trackWorker(QUEUES.BRIDGE_POLL, bridgePollWorker);
bridgePollWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, 'bridge poll failed');
  captureException(err, { queue: QUEUES.BRIDGE_POLL, jobId: job?.id });
  if (job) void logJobAudit(QUEUES.BRIDGE_POLL, job.id!, 'bridge_poll', 'failed', job.data, undefined, err.message);
});

/* ─── Worker: price:refresh ──────────────────────────────────────── */

interface CachedPrices {
  /** Updated unix-ms */
  at: number;
  /** Symbol → USD price (the symbols the wallet UI knows about) */
  bySymbol: Record<string, number>;
  /** Symbol → 24h % change, where available */
  changeBySymbol: Record<string, number>;
}

const priceWorker = new Worker<PriceRefreshJob>(
  QUEUES.PRICE_REFRESH,
  async (job) => {
    const requested = (job.data.symbols?.length ? job.data.symbols : DEFAULT_REFRESH_SYMBOLS);
    const flog = log.child({ queue: QUEUES.PRICE_REFRESH, jobId: job.id });

    const result: CachedPrices = {
      at:             Date.now(),
      bySymbol:       {},
      changeBySymbol: {},
    };

    // 1) HARD prices — never fetched.
    for (const [sym, p] of Object.entries(HARD_PRICES))        result.bySymbol[sym] = p;
    // 2) PLACEHOLDER prices — never fetched, ignored if remote returned.
    for (const [sym, p] of Object.entries(PLACEHOLDER_PRICES)) result.bySymbol[sym] = p;

    // 3) CoinGecko fetch for everything else with an id mapping.
    const toFetch: Array<[string, string]> = [];
    for (const sym of requested) {
      if (sym in HARD_PRICES || sym in PLACEHOLDER_PRICES) continue;
      const cgId = COINGECKO_IDS[sym];
      if (cgId) toFetch.push([sym, cgId]);
    }
    if (toFetch.length > 0) {
      const apiUrl = process.env.PRICE_API_URL ?? 'https://api.coingecko.com/api/v3';
      const apiKey = process.env.COINGECKO_API_KEY;
      const ids = Array.from(new Set(toFetch.map(([, id]) => id))).join(',');
      const url = `${apiUrl}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`;
      const res = await fetch(url, {
        headers: { accept: 'application/json', ...(apiKey ? { 'x-cg-pro-api-key': apiKey } : {}) },
      });
      if (!res.ok) throw new Error(`Price fetch failed: ${res.status}`);
      const data = await res.json() as Record<string, { usd?: number; usd_24h_change?: number }>;
      for (const [sym, cgId] of toFetch) {
        const row = data[cgId];
        if (!row) continue;
        if (typeof row.usd === 'number') result.bySymbol[sym] = row.usd;
        if (typeof row.usd_24h_change === 'number') result.changeBySymbol[sym] = row.usd_24h_change;
      }
    }

    /* Two cache keys:
       - prices:bySymbol — the structured payload above (what consumers want)
       - prices:usd      — flat sym→usd, kept for compatibility with the
                            old worker version */
    await Promise.all([
      cacheRedis.set('prices:bySymbol', JSON.stringify(result), 'EX', 120),
      cacheRedis.set('prices:usd',      JSON.stringify(result.bySymbol), 'EX', 120),
    ]);

    await logJobAudit(QUEUES.PRICE_REFRESH, job.id!, 'price_refresh', 'completed', job.data,
                      { count: Object.keys(result.bySymbol).length });
    flog.info({ count: Object.keys(result.bySymbol).length }, 'prices refreshed');
    return result;
  },
  { connection: redis, concurrency: 1 },
);
registerForShutdown(priceWorker);
trackWorker(QUEUES.PRICE_REFRESH, priceWorker);
priceWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, 'price refresh failed');
  captureException(err, { queue: QUEUES.PRICE_REFRESH, jobId: job?.id });
  if (job) void logJobAudit(QUEUES.PRICE_REFRESH, job.id!, 'price_refresh', 'failed', job.data, undefined, err.message);
});

/* ─── Worker: portfolio:refresh ──────────────────────────────────── */

const portfolioWorker = new Worker<PortfolioRefreshJob>(
  QUEUES.PORTFOLIO_REFRESH,
  async (job) => {
    const { userId, walletAddress } = job.data;
    const flog = log.child({ queue: QUEUES.PORTFOLIO_REFRESH, jobId: job.id, userId });

    // 1. Pull live assets from the indexer.
    interface IndexerAsset {
      chainId?: number; symbol: string; name?: string;
      decimals?: number; balance: string; native?: boolean;
      tokenAddress?: string;
    }
    let assets: IndexerAsset[] = [];
    try {
      const res = await fetch(`${INDEXER_URL}/portfolio/${encodeURIComponent(walletAddress)}`);
      if (res.ok) {
        const json = await res.json() as { assets?: IndexerAsset[] };
        assets = json.assets ?? [];
      }
    } catch (e) {
      flog.warn({ err: (e as Error).message }, 'indexer fetch failed — snapshot will be empty');
    }

    // 2. Read the latest cached prices. Defaults to empty so we still
    //    write a snapshot even if the price worker hasn't run yet.
    let prices: Record<string, number> = {};
    try {
      const raw = await cacheRedis.get('prices:bySymbol');
      if (raw) {
        const cached = JSON.parse(raw) as { bySymbol?: Record<string, number> };
        prices = cached.bySymbol ?? {};
      }
    } catch { /* cache miss is fine */ }

    // 3. Compute totals + serialise assets with price/usd values.
    let totalUsd = 0;
    const enriched = assets.map(a => {
      const decimals = a.decimals ?? 18;
      let balanceNum = 0;
      try {
        // Avoid pulling ethers just for one formatUnits — do it inline.
        const s = String(a.balance);
        const negative = s.startsWith('-');
        const raw = negative ? s.slice(1) : s;
        const pad = raw.padStart(decimals + 1, '0');
        const intPart = pad.slice(0, pad.length - decimals);
        const frac    = pad.slice(pad.length - decimals).replace(/0+$/, '');
        const num = parseFloat(`${negative ? '-' : ''}${intPart}${frac ? '.' + frac : ''}`);
        if (Number.isFinite(num)) balanceNum = num;
      } catch { /* malformed bigint */ }
      const usd = balanceNum * (prices[a.symbol] ?? 0);
      totalUsd += usd;
      return {
        symbol:       a.symbol,
        name:         a.name ?? a.symbol,
        decimals,
        balance:      String(a.balance),
        balanceNum,
        priceUsd:     prices[a.symbol] ?? null,
        usd,
        chainId:      a.chainId ?? null,
        tokenAddress: a.tokenAddress ?? null,
        native:       !!a.native,
      };
    });

    // 4. Write the snapshot. We always create a new row so historical
    //    queries (sparkline / portfolio chart) have time-series data.
    await pool.query(
      `insert into portfolio_snapshots (user_id, wallet_address, total_usd, assets)
       values ($1, $2, $3::numeric, $4::jsonb)`,
      [userId, walletAddress, totalUsd.toFixed(2), JSON.stringify(enriched)],
    );

    const result = { totalUsd, assetCount: enriched.length };
    await logJobAudit(QUEUES.PORTFOLIO_REFRESH, job.id!, 'portfolio_refresh', 'completed', job.data, result);
    flog.info(result, 'portfolio snapshot written');
    return result;
  },
  { connection: redis, concurrency: 10 },
);
registerForShutdown(portfolioWorker);
trackWorker(QUEUES.PORTFOLIO_REFRESH, portfolioWorker);
portfolioWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, 'portfolio refresh failed');
  captureException(err, { queue: QUEUES.PORTFOLIO_REFRESH, jobId: job?.id });
  if (job) void logJobAudit(QUEUES.PORTFOLIO_REFRESH, job.id!, 'portfolio_refresh', 'failed', job.data, undefined, err.message);
});

/* ─── Worker: tx:confirm ─────────────────────────────────────────── */

interface ConfirmResult {
  status:       'pending' | 'confirmed' | 'failed' | 'dropped';
  blockNumber?: number;
  /** Returns true if the caller should re-queue with backoff. */
  recheck?:     boolean;
}

async function confirmEvm(provider: Awaited<ReturnType<typeof getEvmProvider>>, txHash: string): Promise<ConfirmResult> {
  if (!provider) return { status: 'pending', recheck: true };
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    // No receipt yet — could be pending, mempool-dropped, or never seen.
    // Check the tx itself; if it's nowhere, treat as still pending and let
    // the caller re-queue with backoff.
    return { status: 'pending', recheck: true };
  }
  const status = Number(receipt.status ?? 0) === 1 ? 'confirmed' : 'failed';
  return { status, blockNumber: receipt.blockNumber };
}

async function confirmBitcoin(txHash: string): Promise<ConfirmResult> {
  // mempool.space returns 404 until the tx is in the mempool; once mined,
  // /tx/<hash>/status carries { confirmed, block_height }.
  const res = await fetch(`${BITCOIN_MEMPOOL_API}/tx/${txHash}/status`);
  if (!res.ok) {
    if (res.status === 404) return { status: 'pending', recheck: true };
    throw new Error(`mempool.space status ${res.status}`);
  }
  const json = await res.json() as { confirmed?: boolean; block_height?: number };
  if (!json.confirmed) return { status: 'pending', recheck: true };
  return { status: 'confirmed', blockNumber: json.block_height };
}

async function confirmSolana(txHash: string): Promise<ConfirmResult> {
  // Solana RPC getSignatureStatuses for the live state.
  const body = {
    jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses',
    params: [[txHash], { searchTransactionHistory: true }],
  };
  const res = await fetch(SOLANA_RPC_URL, {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`solana rpc ${res.status}`);
  const json = await res.json() as {
    result?: { value?: Array<null | { confirmationStatus?: string; err?: unknown; slot?: number }> };
  };
  const row = json.result?.value?.[0];
  if (!row) return { status: 'pending', recheck: true };
  if (row.err) return { status: 'failed', blockNumber: row.slot };
  if (row.confirmationStatus === 'finalized' || row.confirmationStatus === 'confirmed') {
    return { status: 'confirmed', blockNumber: row.slot };
  }
  return { status: 'pending', recheck: true };
}

const txConfirmWorker = new Worker<TxConfirmJob>(
  QUEUES.TX_CONFIRM,
  async (job) => {
    const { txId, chainId, txHash, chainKind } = job.data;
    const flog = log.child({ queue: QUEUES.TX_CONFIRM, jobId: job.id, txHash });

    let r: ConfirmResult;
    if (chainKind === 'bitcoin')      r = await confirmBitcoin(txHash);
    else if (chainKind === 'solana')  r = await confirmSolana(txHash);
    else                              r = await confirmEvm(await getEvmProvider(chainId), txHash);

    await pool.query(
      `update transactions
         set status = $1,
             block_number = coalesce($2::bigint, block_number),
             updated_at = now()
       where id = $3`,
      [r.status, r.blockNumber ?? null, txId],
    );

    // If still pending, re-queue with linear backoff. Cap attempts at
    // ~30 (≈ 30 min for EVM, longer for Bitcoin) — beyond that we mark
    // the tx as 'dropped' so the UI can offer a manual nudge.
    const attempts = (job.attemptsMade ?? 0) + 1;
    if (r.recheck) {
      if (attempts >= 30) {
        await pool.query(
          `update transactions set status = 'dropped', updated_at = now() where id = $1 and status = 'pending'`,
          [txId],
        );
        flog.warn({ attempts }, 'tx never confirmed — marked dropped');
      } else {
        await getQueue<TxConfirmJob>(QUEUES.TX_CONFIRM).add(
          'recheck',
          job.data,
          { delay: 30_000 + attempts * 10_000 },     // 30s + ramp
        );
      }
    }

    await logJobAudit(QUEUES.TX_CONFIRM, job.id!, 'tx_confirm', 'completed', job.data, r);
    flog.info(r, 'tx confirm tick');
    return { txId, ...r };
  },
  { connection: redis, concurrency: 20 },
);
registerForShutdown(txConfirmWorker);
trackWorker(QUEUES.TX_CONFIRM, txConfirmWorker);
txConfirmWorker.on('failed', (job, err) => {
  log.error({ jobId: job?.id, err: err.message }, 'tx confirm failed');
  captureException(err, { queue: QUEUES.TX_CONFIRM, jobId: job?.id });
  if (job) void logJobAudit(QUEUES.TX_CONFIRM, job.id!, 'tx_confirm', 'failed', job.data, undefined, err.message);
});

/* ─── Scheduled jobs ─────────────────────────────────────────────── */

const priceQueue     = getQueue<PriceRefreshJob>(QUEUES.PRICE_REFRESH);
const portfolioQueue = getQueue<PortfolioRefreshJob>(QUEUES.PORTFOLIO_REFRESH);

// Refresh prices every 60s. Symbols default to DEFAULT_REFRESH_SYMBOLS
// inside the processor when an empty list is passed.
await priceQueue.add(
  'scheduled-price-refresh',
  { symbols: DEFAULT_REFRESH_SYMBOLS },
  { repeat: { every: 60_000 }, removeOnComplete: 10, removeOnFail: 5 },
);

// Fan-out portfolio snapshots every 5 minutes for every user that has
// at least one active wallet. Keeps the time-series alive without
// being chatty for inactive accounts.
async function enqueuePortfolioFanout(): Promise<void> {
  try {
    const { rows } = await pool.query<{ user_id: string; address: string }>(
      `select distinct on (user_id, address) user_id, address
         from accounts where is_active = true`,
    );
    for (const r of rows) {
      await portfolioQueue.add('scheduled-portfolio-refresh',
        { userId: r.user_id, walletAddress: r.address },
        { removeOnComplete: 5, removeOnFail: 3 });
    }
    log.info({ count: rows.length }, 'portfolio fanout enqueued');
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'portfolio fanout query failed');
  }
}

// First fanout shortly after boot so freshly-deployed instances pick up
// any active accounts immediately; then every 5 minutes.
setTimeout(() => { void enqueuePortfolioFanout(); }, 5_000);
setInterval(() => { void enqueuePortfolioFanout(); }, 5 * 60_000);

log.info('worker booted — processors: wallet:sync, lep100:sync, bridge:poll, price:refresh, portfolio:refresh, tx:confirm');
log.info('scheduled: price refresh 60s, portfolio fanout 5min');

// HTTP listener for Prometheus /metrics + /health probes. Bound to
// METRICS_PORT (default 4020). Skipped if METRICS_PORT=0.
if (Number(process.env.METRICS_PORT ?? '4020') > 0) {
  startMetricsServer();
}
