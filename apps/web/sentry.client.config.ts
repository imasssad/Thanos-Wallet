/**
 * Sentry — browser-side init.
 *
 * Fires on the client; never enabled if NEXT_PUBLIC_SENTRY_DSN is unset
 * (i.e. local dev). 10% performance sampling in prod, 100% in dev.
 *
 * Important: we strip mnemonic / password fields out of every event below
 * via beforeSend — the vault module never logs them, but defence-in-depth.
 */
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    replaysSessionSampleRate: 0, // no session replay in v1 — wallet UI
    replaysOnErrorSampleRate: 0, // privacy: don't record key-handling screens
    beforeSend(event) {
      // Belt-and-braces redaction. Never let a mnemonic / password / vault
      // ciphertext leave the browser via error reporting.
      const SCRUB = /(mnemonic|password|seed|private[_-]?key|vault|session[_-]?key)/i;
      const scrub = (obj: unknown): unknown => {
        if (!obj || typeof obj !== 'object') return obj;
        const out: Record<string, unknown> = Array.isArray(obj) ? [...obj] as never : { ...(obj as Record<string, unknown>) };
        for (const k of Object.keys(out)) {
          if (SCRUB.test(k)) out[k] = '[redacted]';
          else out[k] = scrub(out[k]);
        }
        return out;
      };
      return scrub(event) as Sentry.ErrorEvent;
    },
  });
}
