import 'dotenv/config';
import { initSentry } from './lib/sentry.js';
// Initialise Sentry BEFORE the app factory imports anything else so it can
// instrument unhandled errors that fire at module load. No-op when DSN
// is unset (local dev / CI).
initSentry('thanos-api');

import { createApp } from './app.js';
import { log } from './lib/log.js';

const app  = createApp();
const port = parseInt(process.env.PORT ?? '4000', 10);

app.listen(port, () => {
  log.info({ port, env: process.env.NODE_ENV ?? 'development' }, 'api listening');
});
