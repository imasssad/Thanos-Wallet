/**
 * Sentry — browser-side init.
 *
 * Fires on the client; never enabled if NEXT_PUBLIC_SENTRY_DSN is unset
 * (i.e. local dev). 10% performance sampling in prod, 100% in dev.
 *
 * Important: every event is scrubbed of wallet secrets below (sdk-core
 * telemetry-scrub): secret-named fields, and a recovery phrase or private
 * key quoted inside any string — an error message, a breadcrumb, a URL.
 * An event that can't be scrubbed is dropped. The vault module never logs
 * them, but defence-in-depth.
 */
import * as Sentry from '@sentry/nextjs';
import { scrubOrDropEvent } from '@thanos/sdk-core/src/security/telemetry-scrub';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    replaysSessionSampleRate: 0, // no session replay in v1 — wallet UI
    replaysOnErrorSampleRate: 0, // privacy: don't record key-handling screens
    // Never let a mnemonic / private key / password / vault ciphertext leave
    // the browser via error reporting — or via a trace's span descriptions.
    beforeSend: scrubOrDropEvent,
    beforeSendTransaction: scrubOrDropEvent,
  });
}
