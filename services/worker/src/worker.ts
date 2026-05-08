import 'dotenv/config';
import { Worker, Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import pg from 'pg';
import {
  QUEUES,
  type WalletSyncJob,
  type Lep100SyncJob,
  type BridgePollJob,
  type PortfolioRefreshJob,
  type PriceRefreshJob,
  type TxConfirmJob,
} from './queues/definitions.js';

// ─── Connections ─────────────────────────────────────────────────────────────

if (!process.env.REDIS_URL)    throw new Error('REDIS_URL required');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// ─── Helper ──────────────────────────────────────────────────────────────────

async function updateBridgeJob(executionId: string, status: string, raw?: unknown) {
  await pool.query(
    `UPDATE bridge_jobs SET status = $1, raw_status = $2, updated_at = NOW()
     WHERE execution_id = $3`,
    [status, raw ? JSON.stringify(raw) : null, executionId]
  );
}

async function logJobAudit(
  queueName: string, jobId: string, jobType: string,
  status: string, payload: unknown, result?: unknown, error?: string
) {
  await pool.query(
    `INSERT INTO job_audit (queue_name, job_id, job_type, status, payload, result, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [queueName, jobId, jobType, status, JSON.stringify(payload), result ? JSON.stringify(result) : null, error ?? null]
  );
}

// ─── Worker: wallet:sync ─────────────────────────────────────────────────────

new Worker<WalletSyncJob>(
  QUEUES.WALLET_SYNC,
  async (job) => {
    const { userId, accountId, chainId, address, mode } = job.data;
    console.log(`[wallet:sync] ${address} chain=${chainId} mode=${mode}`);

    // TODO (Day 4): call RPC clients to fetch real balance + tx history
    // For now we mark the job as processed so the queue infrastructure works
    await pool.query(
      `UPDATE accounts SET is_active = true WHERE id = $1`,
      [accountId]
    );

    await logJobAudit(QUEUES.WALLET_SYNC, job.id!, 'wallet_sync', 'completed', job.data);
    return { synced: true, address, chainId };
  },
  {
    connection,
    concurrency: 5,
    limiter: { max: 20, duration: 1000 },
  }
);

// ─── Worker: lep100:sync ──────────────────────────────────────────────────────

new Worker<Lep100SyncJob>(
  QUEUES.LEP100_SYNC,
  async (job) => {
    const { chainId, contractAddress, mode, cursor } = job.data;
    console.log(`[lep100:sync] ${contractAddress} chain=${chainId} mode=${mode} cursor=${cursor}`);

    const indexerUrl = process.env.INDEXER_URL ?? 'http://localhost:4010';
    const res = await fetch(`${indexerUrl}/lep100/sync`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chainId, contractAddress, mode, cursor }),
    });

    if (!res.ok) throw new Error(`Indexer sync failed: ${res.status}`);
    const result = await res.json();

    await logJobAudit(QUEUES.LEP100_SYNC, job.id!, 'lep100_sync', 'completed', job.data, result);
    return result;
  },
  { connection, concurrency: 3 }
);

// ─── Worker: bridge:poll ──────────────────────────────────────────────────────

new Worker<BridgePollJob>(
  QUEUES.BRIDGE_POLL,
  async (job) => {
    const { bridgeJobId, executionId, provider, attemptCount } = job.data;
    console.log(`[bridge:poll] ${executionId} attempt=${attemptCount}`);

    const multxUrl = process.env.MULTX_API_URL;
    const multxKey = process.env.MULTX_API_KEY;

    if (!multxUrl || !multxKey) {
      console.warn('[bridge:poll] MULTX_API_URL/KEY not configured — skipping poll');
      return { skipped: true };
    }

    const res = await fetch(`${multxUrl}/bridge/status/${executionId}`, {
      headers: { Authorization: `Bearer ${multxKey}` },
    });

    if (!res.ok) throw new Error(`MultX status check failed: ${res.status}`);
    const status = await res.json();

    // Map MultX status to our internal status
    const internalStatus =
      status.state === 'completed' ? 'completed' :
      status.state === 'failed'    ? 'failed'    :
      status.state === 'settling'  ? 'settling'  :
      'bridging';

    await updateBridgeJob(executionId, internalStatus, status);

    // If still in progress, re-queue with backoff
    if (!['completed', 'failed'].includes(internalStatus)) {
      const bridgePollQueue = new Queue(QUEUES.BRIDGE_POLL, { connection });
      await bridgePollQueue.add('poll', {
        ...job.data,
        attemptCount: attemptCount + 1,
      }, {
        delay: Math.min(30_000 * (attemptCount + 1), 300_000), // max 5 min
      });
    }

    await logJobAudit(QUEUES.BRIDGE_POLL, job.id!, 'bridge_poll', 'completed', job.data, status);
    return { status: internalStatus };
  },
  { connection, concurrency: 10 }
);

// ─── Worker: portfolio:refresh ────────────────────────────────────────────────

new Worker<PortfolioRefreshJob>(
  QUEUES.PORTFOLIO_REFRESH,
  async (job) => {
    const { userId, walletAddress } = job.data;
    console.log(`[portfolio:refresh] user=${userId} wallet=${walletAddress}`);

    // TODO (Day 4+): aggregate real balances from indexer + price service
    // Placeholder — records a snapshot timestamp
    await pool.query(
      `INSERT INTO portfolio_snapshots (user_id, wallet_address, total_usd, assets)
       VALUES ($1, $2, '0', '[]')
       ON CONFLICT DO NOTHING`,
      [userId, walletAddress]
    );

    await logJobAudit(QUEUES.PORTFOLIO_REFRESH, job.id!, 'portfolio_refresh', 'completed', job.data);
    return { refreshed: true };
  },
  { connection, concurrency: 10 }
);

// ─── Worker: price:refresh ────────────────────────────────────────────────────

new Worker<PriceRefreshJob>(
  QUEUES.PRICE_REFRESH,
  async (job) => {
    const { symbols } = job.data;
    console.log(`[price:refresh] symbols=${symbols.join(',')}`);

    const apiUrl  = process.env.PRICE_API_URL ?? 'https://api.coingecko.com/api/v3';
    const apiKey  = process.env.COINGECKO_API_KEY;
    const ids     = symbols.map((s) => s.toLowerCase()).join(',');
    const url     = `${apiUrl}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

    const res = await fetch(url, {
      headers: apiKey ? { 'x-cg-pro-api-key': apiKey } : {},
    });

    if (!res.ok) throw new Error(`Price fetch failed: ${res.status}`);
    const prices = await res.json();

    // Cache prices in Redis with 60-second TTL
    const { default: Redis } = await import('ioredis');
    const r = new Redis(process.env.REDIS_URL!);
    await r.set('prices:usd', JSON.stringify(prices), 'EX', 60);
    await r.quit();

    await logJobAudit(QUEUES.PRICE_REFRESH, job.id!, 'price_refresh', 'completed', job.data, prices);
    return prices;
  },
  { connection, concurrency: 1 }
);

// ─── Worker: tx:confirm ───────────────────────────────────────────────────────

new Worker<TxConfirmJob>(
  QUEUES.TX_CONFIRM,
  async (job) => {
    const { txId, chainId, txHash, chainKind } = job.data;
    console.log(`[tx:confirm] ${txHash} chain=${chainId} kind=${chainKind}`);

    // TODO (Day 4): call chain RPC to check confirmation
    // For now mark as pending — real RPC check wired in Day 4
    await pool.query(
      `UPDATE transactions SET status = 'pending', updated_at = NOW() WHERE id = $1`,
      [txId]
    );

    await logJobAudit(QUEUES.TX_CONFIRM, job.id!, 'tx_confirm', 'completed', job.data);
    return { txId, checked: true };
  },
  { connection, concurrency: 20 }
);

// ─── Scheduled Jobs ───────────────────────────────────────────────────────────

const priceQueue     = new Queue(QUEUES.PRICE_REFRESH,     { connection });
const portfolioQueue = new Queue(QUEUES.PORTFOLIO_REFRESH, { connection });

// Refresh prices every 60 seconds
await priceQueue.add(
  'scheduled-price-refresh',
  { symbols: ['lithosphere', 'bitcoin', 'solana', 'ethereum', 'binancecoin'] },
  { repeat: { every: 60_000 }, removeOnComplete: 10, removeOnFail: 5 }
);

console.log('[worker] all workers started');
console.log('[worker] scheduled: price refresh every 60s');
