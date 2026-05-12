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

export function createApp(): express.Express {
  const app = express();

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

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[api] unhandled error', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
