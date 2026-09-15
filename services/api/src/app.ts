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
import { laxRouter, laxWebhookRouter } from './routes/lax.js';
import { portfolioRouter } from './routes/portfolio.js';
import { pushRouter } from './routes/push.js';
import { wcSessionsRouter } from './routes/wc-sessions.js';
import { metricsHandler, metricsMiddleware } from './lib/metrics.js';
import { captureException } from './lib/sentry.js';

export function createApp(): express.Express {
  const app = express();

  /* Behind nginx on the VPS, req.ip is the proxy's address unless we
     trust exactly one hop — without this, every per-IP rate limit
     collapses onto a single shared key (one abusive client exhausts the
     budget for everyone). `1` trusts only the first proxy, so clients
     can't spoof X-Forwarded-For chains to rotate their identity. */
  app.set('trust proxy', 1);

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

  // Keep webhook and proxy payloads small. LAX sends compact card events;
  // accepting megabyte-sized unauthenticated bodies only increases the DoS
  // surface before the webhook secret can be checked.
  app.use(express.json({ limit: '256kb' }));
  app.use(generalLimiter);

  app.use('/auth', authRouter);
  app.use('/contacts', contactsRouter);
  app.use('/dnns', dnnsRouter);
  app.use('/lax', laxRouter);
  // Unauthenticated — Zypto's servers have no Thanos session. Separate
  // mount (not a /lax sub-path) so it's never accidentally caught by
  // laxRouter's requireAuth. See routes/lax.ts's laxWebhookRouter comment.
  app.use('/lax-webhook', laxWebhookRouter);
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

  /** GET /app-version — the latest published mobile app version, for the
   *  in-app "update available" banner. Unauthenticated (checked before
   *  login, and it's not sensitive). Driven entirely by env vars set on
   *  the VPS — nothing here knows the real App Store / Play Store state,
   *  so these MUST be bumped by hand after every mobile release:
   *    LATEST_IOS_VERSION        e.g. "2.0.1"  (matches app.json's version)
   *    LATEST_ANDROID_VERSION    e.g. "2.0.1"
   *  Left unset, the field is omitted and the client treats it as
   *  "nothing to compare against" — never a false "update available".
   */
  app.get('/app-version', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      ios:     process.env.LATEST_IOS_VERSION || null,
      android: process.env.LATEST_ANDROID_VERSION || null,
    });
  });

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
