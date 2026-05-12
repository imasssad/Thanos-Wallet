/**
 * Sentry — Next.js server-side init (route handlers, RSC, edge-runtime opt-in).
 *
 * Same DSN gating as the client config: if NEXT_PUBLIC_SENTRY_DSN is unset
 * (dev / local CI / preview builds), Sentry never initialises.
 *
 * The web app is mostly a thin client over the indexer, so server errors are
 * rare — what we mainly want here is unhandled rejections in route handlers.
 */
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'production',
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    beforeSend(event) {
      // Same scrub as client — defence-in-depth so a misrouted SSR error
      // can't leak vault material into Sentry.
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
