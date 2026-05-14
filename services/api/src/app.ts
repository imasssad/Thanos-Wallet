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
import { authRouter } from './routes/auth.js';
import { metricsHandler, metricsMiddleware } from './lib/metrics.js';
import { captureException } from './lib/sentry.js';

export function createApp(): express.Express {
  const app = express();

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
    captureException(err, { route: req.originalUrl, method: req.method });
    // Lazy import so app.ts doesn't depend on log.ts at module load (test ergonomics).
    import('./lib/log.js').then(({ log }) => log.error({ err: err.message, stack: err.stack }, 'unhandled error'));
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
