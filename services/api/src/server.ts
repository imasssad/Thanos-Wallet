import 'dotenv/config';
import { initSentry } from './lib/sentry.js';
// Initialise Sentry BEFORE the app factory imports anything else so it can
// instrument unhandled errors that fire at module load. No-op when DSN
// is unset (local dev / CI).
initSentry('thanos-api');

import { createApp } from './app.js';
import { log } from './lib/log.js';
import { ensurePushSchema } from './lib/push.js';

const app  = createApp();
const port = parseInt(process.env.PORT ?? '4000', 10);

// Idempotently create the push_tokens table (schema.sql only runs on a
// fresh volume; this keeps existing deployments in sync). Non-fatal.
ensurePushSchema().catch((err) => log.warn({ err: (err as Error).message }, 'ensurePushSchema failed'));

app.listen(port, () => {
  log.info({ port, env: process.env.NODE_ENV ?? 'development' }, 'api listening');
});
