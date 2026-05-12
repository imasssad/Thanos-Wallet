import 'dotenv/config';
import { createApp } from './app.js';

const app  = createApp();
const port = parseInt(process.env.PORT ?? '4000', 10);

app.listen(port, () => {
  console.log(`[api] listening on port ${port} (${process.env.NODE_ENV ?? 'development'})`);
});
