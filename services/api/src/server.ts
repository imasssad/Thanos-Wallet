import 'dotenv/config';
import { createApp } from './app.js';
import { log } from './lib/log.js';

const app  = createApp();
const port = parseInt(process.env.PORT ?? '4000', 10);

app.listen(port, () => {
  log.info({ port, env: process.env.NODE_ENV ?? 'development' }, 'api listening');
});
