/**
 * Prometheus metrics for the API service.
 *
 * Exposed at GET /metrics. Default Node.js metrics (heap, event loop
 * lag, GC, CPU) plus per-route HTTP histograms — request count and
 * duration broken down by method/route/status_code.
 *
 * Route labels use the Express route pattern (e.g. "/auth/login")
 * rather than the raw path, so we don't blow cardinality on dynamic
 * params (path-id explosions are the #1 cause of Prometheus OOMs).
 */
import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'thanos-api' });
collectDefaultMetrics({ register: registry });

const httpRequests = new Counter({
  name:       'http_requests_total',
  help:       'Count of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers:  [registry],
});

const httpDuration = new Histogram({
  name:       'http_request_duration_seconds',
  help:       'Latency of HTTP requests (seconds)',
  labelNames: ['method', 'route', 'status_code'],
  /* SLO-shaped buckets: anything past the 1s mark is "slow". p99 ~ 300ms
     target for auth endpoints. */
  buckets:    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers:  [registry],
});

/** Express middleware that times every request and records its outcome. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ns = Number(process.hrtime.bigint() - start);
    const seconds = ns / 1e9;
    // Route fallback to '/unknown' guards against the matcher being
    // undefined for 404s — without it the label is 'undefined' and
    // we'd still leak cardinality on dynamic 404 paths.
    const route = req.route?.path
      ?? req.baseUrl  // mounted-router prefix when no specific route matched
      ?? '/unknown';
    const labels = {
      method:      req.method,
      route,
      status_code: String(res.statusCode),
    };
    httpRequests.inc(labels);
    httpDuration.observe(labels, seconds);
  });
  next();
}

/** GET /metrics handler — returns the Prometheus text exposition. */
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
}
