/**
 * Sentry — Next.js edge-runtime init.
 *
 * Required by @sentry/nextjs even though we don't currently run any
 * `runtime: 'edge'` routes — the Sentry build plugin wires this file in
 * automatically and warns if it's missing.
 */
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  });
}
