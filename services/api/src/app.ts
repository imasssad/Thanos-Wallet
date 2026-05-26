/**
 * Express app factory.
 *
 * Split out from server.ts so tests can import the wired-up app without
 * starting an HTTP listener (supertest passes the app object directly).
 */
import cors from 'cors';
import express from 'express';
import { checkDbConnection } from './lib/db.js';
import { checkRedisConnection } from './lib/redis.js';
import { generalLimiter } from './middleware/rate-limit.js';
import { requestId, type LoggedRequest } from './middleware/request-id.js';
import { authRouter } from './routes/auth.js';
import { contactsRouter } from './routes/contacts.js';
import { dnnsRouter } from './routes/dnns.js';
import { portfolioRouter } from './routes/portfolio.js';
import { pushRouter } from './routes/push.js';
import { wcSessionsRouter } from './routes/wc-sessions.js';
import { metricsHandler, metricsMiddleware } from './lib/metrics.js';
import { captureException } from './lib/sentry.js';

export function createApp(): express.Express {
  const app = express();

  /* Request-ID first so every log line + metric + error has a
     correlation id, even ones from middleware that rejects below. */
  app.use(requestId);

  /* Metrics middleware MUST run before everything else so route timing
     covers any rate-limit / CORS rejection latency too. The /metrics
     endpoint is exposed unauthenticated (Prometheus scrapes via the
     Docker network; not exposed publicly via nginx). */
  app.use(metricsMiddleware);
  app.get('/metrics', metricsHandler);

  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',');

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(generalLimiter);

  app.use('/auth', authRouter);
  app.use('/contacts', contactsRouter);
  app.use('/dnns', dnnsRouter);
  app.use('/portfolio', portfolioRouter);
  app.use('/push', pushRouter);
  app.use('/wc/sessions', wcSessionsRouter);

  // Forced-exception endpoint for verifying Sentry wiring after a
  // first deploy. Gated on SENTRY_DEBUG_ENDPOINT=1 so it doesn't ship
  // by default — operator flips the env var, hits the endpoint once,
  // confirms the exception arrived in Sentry, then turns it back off.
  if (process.env.SENTRY_DEBUG_ENDPOINT === '1') {
    app.post('/debug/sentry-test', (_req, res) => {
      const err = new Error('Sentry verification — synthetic exception');
      captureException(err, { source: '/debug/sentry-test' });
      res.json({ ok: true, dispatched: true });
    });
  }

  app.get('/health', async (_req, res) => {
    const [db, cache] = await Promise.all([
      checkDbConnection(),
      checkRedisConnection(),
    ]);
    const healthy = db && cache;
    res.status(healthy ? 200 : 503).json({
      ok:      healthy,
      service: 'thanos-api',
      checks:  { db, redis: cache },
      ts:      new Date().toISOString(),
    });
  });

  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const r = req as LoggedRequest;
    captureException(err, { route: req.originalUrl, method: req.method, requestId: r.id });
    // r.log is a child logger bound with requestId so the error line
    // correlates with the request's other logs.
    r.log?.error({ err: err.message, stack: err.stack, route: req.originalUrl }, 'unhandled error');
    res.status(500).json({ error: 'Internal server error', requestId: r.id });
  });

  return app;
}
