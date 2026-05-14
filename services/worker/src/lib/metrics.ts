/**
 * Prometheus metrics for the BullMQ worker.
 *
 * Beyond the Node defaults, we expose per-queue:
 *   thanos_worker_jobs_total{queue,status}      — completed / failed counter
 *   thanos_worker_job_duration_seconds{queue}   — processing-time histogram
 *   thanos_worker_queue_depth{queue,state}      — gauge sampled every 15s
 *
 * The queue-depth gauge polls BullMQ's getJobCounts() so we can alert
 * on workers falling behind. The poll lives here rather than in
 * worker.ts so all observability surface stays in one module.
 *
 * Express listener is bound at a SEPARATE port (default 4020) — the
 * worker is otherwise headless. Bind to localhost only by default;
 * Prometheus scrapes via host.docker.internal in the compose stack.
 */
import express, { type Request, type Response } from 'express';
import {
  Registry, collectDefaultMetrics, Counter, Histogram, Gauge,
} from 'prom-client';
import { Queue } from 'bullmq';
import { QUEUES, type QueueName } from '../queues/definitions.js';
import { redis, registerForShutdown } from './connections.js';
import { log } from '../log.js';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'thanos-worker' });
collectDefaultMetrics({ register: registry });

const jobs = new Counter({
  name: 'thanos_worker_jobs_total',
  help: 'Worker jobs processed by queue + status',
  labelNames: ['queue', 'status'],
  registers: [registry],
});
const jobDuration = new Histogram({
  name: 'thanos_worker_job_duration_seconds',
  help: 'Worker job processing time (seconds)',
  labelNames: ['queue', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [registry],
});
const queueDepth = new Gauge({
  name: 'thanos_worker_queue_depth',
  help: 'BullMQ queue depth by state',
  labelNames: ['queue', 'state'],
  registers: [registry],
});

/* ─── Worker.on('completed' | 'failed') wiring ─────────────────────── */

/** Attach a Worker so metrics record on every job lifecycle. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trackWorker(name: QueueName, worker: any): void {
  worker.on('completed', (job: { processedOn?: number; finishedOn?: number }) => {
    jobs.inc({ queue: name, status: 'completed' });
    const ms = (job.finishedOn ?? 0) - (job.processedOn ?? 0);
    if (ms > 0) jobDuration.observe({ queue: name, status: 'completed' }, ms / 1000);
  });
  worker.on('failed', (job: { processedOn?: number; finishedOn?: number } | undefined) => {
    jobs.inc({ queue: name, status: 'failed' });
    if (job?.processedOn && job?.finishedOn) {
      const ms = job.finishedOn - job.processedOn;
      if (ms > 0) jobDuration.observe({ queue: name, status: 'failed' }, ms / 1000);
    }
  });
}

/* ─── Queue depth poller ──────────────────────────────────────────── */

const STATES: Array<'wait' | 'active' | 'delayed' | 'failed'> = ['wait', 'active', 'delayed', 'failed'];

const depthQueues = new Map<QueueName, Queue>();
function depthQueue(name: QueueName): Queue {
  let q = depthQueues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis });
    depthQueues.set(name, q);
  }
  return q;
}

async function pollOnce(): Promise<void> {
  for (const name of Object.values(QUEUES)) {
    try {
      const counts = await depthQueue(name).getJobCounts(...STATES);
      for (const state of STATES) {
        queueDepth.set({ queue: name, state }, counts[state] ?? 0);
      }
    } catch (e) {
      log.warn({ queue: name, err: (e as Error).message }, 'queue depth poll failed');
    }
  }
}

let _pollTimer: NodeJS.Timeout | null = null;
function startDepthPolling(intervalMs = 15_000): void {
  if (_pollTimer) return;
  void pollOnce();
  _pollTimer = setInterval(() => { void pollOnce(); }, intervalMs);
}
function stopDepthPolling(): void {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/* ─── HTTP listener ───────────────────────────────────────────────── */

export function startMetricsServer(port = Number(process.env.METRICS_PORT || 4020)): void {
  const app = express();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'thanos-worker' });
  });
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  const server = app.listen(port, () => {
    log.info({ port }, 'worker metrics server listening');
  });
  startDepthPolling();
  registerForShutdown({
    close: () => new Promise<void>(resolve => {
      stopDepthPolling();
      // Close queue handles + http listener.
      for (const q of depthQueues.values()) { q.close().catch(() => {}); }
      server.close(() => resolve());
    }),
  });
}
