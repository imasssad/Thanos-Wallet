/**
 * Prometheus metrics for the indexer.
 *
 * Beyond the default Node metrics, we expose two indexer-specific
 * gauges + a counter:
 *   thanos_indexer_head_block      — latest chain head we've seen
 *   thanos_indexer_cursor_block    — last block we've processed
 *   thanos_indexer_sync_lag_blocks — head - cursor (the alert signal)
 *   thanos_indexer_events_total    — Transfer events indexed
 *   http_requests_total            — per-route request count
 *   http_request_duration_seconds  — per-route latency histogram
 *
 * Sync gauges are updated from lep100-sync.ts via setSyncMetrics().
 */
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'thanos-indexer' });
collectDefaultMetrics({ register: registry });

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Count of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});
const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Latency of HTTP requests (seconds)',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

const headBlock = new Gauge({
  name: 'thanos_indexer_head_block',
  help: 'Latest chain head block number',
  registers: [registry],
});
const cursorBlock = new Gauge({
  name: 'thanos_indexer_cursor_block',
  help: 'Last block the sync loop has processed',
  registers: [registry],
});
const syncLag = new Gauge({
  name: 'thanos_indexer_sync_lag_blocks',
  help: 'head - cursor (alert when > 200 blocks for > 5 min)',
  registers: [registry],
});
const eventsTotal = new Counter({
  name: 'thanos_indexer_events_total',
  help: 'Transfer / Approval events indexed (cumulative)',
  registers: [registry],
});

export function setSyncMetrics(args: { head: number; cursor: number; eventsThisPass: number }): void {
  headBlock.set(args.head);
  cursorBlock.set(args.cursor);
  syncLag.set(Math.max(0, args.head - args.cursor));
  if (args.eventsThisPass > 0) eventsTotal.inc(args.eventsThisPass);
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path ?? req.baseUrl ?? '/unknown';
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequests.inc(labels);
    httpDuration.observe(labels, seconds);
  });
  next();
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
}
