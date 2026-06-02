/**
 * Shared connection pools — Redis, Postgres, and BullMQ Queue handles.
 *
 * The original worker.ts opened a fresh `new Redis(...)` inside the
 * price-refresh processor and a fresh `new Queue(...)` inside the
 * bridge-poll re-queue path. Both leak under load — at N jobs/sec you
 * get N TCP connections clambering for sockets in TIME_WAIT.
 *
 * Now every queue + every processor reuses the singletons declared here.
 * `shutdown()` closes them in the correct order on SIGTERM/SIGINT so the
 * container stops cleanly under docker-compose / k8s rolling updates.
 */
import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { QUEUES, type QueueName } from '../queues/definitions.js';
import { log } from '../log.js';

/* ─── Env ──────────────────────────────────────────────────────────── */

if (!process.env.REDIS_URL)    throw new Error('REDIS_URL required');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

/* ─── Redis (BullMQ requires maxRetriesPerRequest: null) ──────────── */

const redisInstance = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck:     false,
});
redisInstance.on('error', err => log.error({ err: err.message }, 'redis error'));

/* Cast to ConnectionOptions at the export site — at runtime BullMQ
 * accepts a Redis instance directly (its type union explicitly includes
 * IORedis.Redis), but the monorepo hoists ioredis at multiple versions
 * so the structural-type comparison can fail at the API boundary. The
 * cast happens once here so callers see clean types. */
export const redis: Redis & ConnectionOptions =
  redisInstance as Redis & ConnectionOptions;

/* Separate Redis for cache reads / writes — BullMQ holds the main one
   in a blocking BRPOPLPUSH; a price-write while the worker is parked
   on a queue read causes head-of-line blocking. */
export const cacheRedis = new Redis(process.env.REDIS_URL);
cacheRedis.on('error', err => log.error({ err: err.message }, 'cache redis error'));

/* ─── Postgres ────────────────────────────────────────────────────── */

const { Pool } = pg;
export const pool = new Pool({
  connectionString:   process.env.DATABASE_URL,
  max:                Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis:  30_000,
});
pool.on('error', err => log.error({ err: err.message }, 'pg pool error'));

/* ─── Shared BullMQ Queue handles ─────────────────────────────────── */

const queues = new Map<QueueName, Queue>();
export function getQueue<T = unknown>(name: QueueName): Queue<T> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis });
    queues.set(name, q);
  }
  return q as Queue<T>;
}

/** QueueEvents for telemetry. One per queue at most. */
const queueEvents = new Map<QueueName, QueueEvents>();
export function getQueueEvents(name: QueueName): QueueEvents {
  let qe = queueEvents.get(name);
  if (!qe) {
    qe = new QueueEvents(name, { connection: redis });
    queueEvents.set(name, qe);
  }
  return qe;
}

/* ─── Graceful shutdown ──────────────────────────────────────────── */

type Closeable = { close(): Promise<unknown> | unknown };
const closeables = new Set<Closeable>();

/** Register anything that should be closed on SIGTERM. */
export function registerForShutdown(c: Closeable): void {
  closeables.add(c);
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutting down');

  // 1) Stop accepting new jobs — close every registered Worker.
  for (const c of closeables) {
    try { await c.close(); } catch (e) { log.warn({ err: (e as Error).message }, 'close error'); }
  }
  // 2) Drain shared queues + queue events.
  for (const q of queues.values()) {
    try { await q.close(); } catch {}
  }
  for (const qe of queueEvents.values()) {
    try { await qe.close(); } catch {}
  }
  // 3) Tear down connections last.
  try { await pool.end(); } catch {}
  try { await redis.quit(); } catch {}
  try { await cacheRedis.quit(); } catch {}

  log.info('shutdown complete');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

/* Crash-loop diagnostics — never exit silently. */
process.on('uncaughtException', err => log.fatal({ err: err.message, stack: err.stack }, 'uncaughtException'));
process.on('unhandledRejection', err => log.fatal({ err: String(err) }, 'unhandledRejection'));
