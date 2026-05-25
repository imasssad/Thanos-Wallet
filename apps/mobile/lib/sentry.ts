/**
 * Sentry on the mobile app.
 *
 * Mirrors the web/desktop/extension hookup — only initialises when a DSN
 * is present (via EXPO_PUBLIC_SENTRY_DSN), so local dev + EAS preview
 * builds without the env var stay silent. The `beforeSend` hook applies
 * the same recursive scrub for `mnemonic|password|seed|private_key|
 * vault|session_key|token|authorization` that the other clients use.
 *
 * Wrap the root component with `Sentry.wrap()` (see App.tsx) to enable
 * automatic crash + JS-error capture. Manual reporting via
 * `captureException(e)` is available for caught-and-handled errors.
 */
import * as Sentry from '@sentry/react-native';

const DSN     = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
const ENV     = process.env.EXPO_PUBLIC_ENV       ?? 'production';
const RELEASE = process.env.EXPO_PUBLIC_RELEASE   ?? undefined;

const SCRUB_RE = /(mnemonic|password|seed|private[_-]?key|vault|session[_-]?key|token|authorization)/i;

function scrub(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrub);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SCRUB_RE.test(k) ? '[redacted]' : scrub(v);
  }
  return out;
}

let initialised = false;

export function initSentry(): void {
  if (initialised) return;
  if (!DSN) return;  // no-op when no DSN — keeps local + CI quiet
  Sentry.init({
    dsn:                  DSN,
    environment:          ENV,
    release:              RELEASE,
    enableAutoSessionTracking: true,
    tracesSampleRate:     0.05,
    // Strip request-body breadcrumbs that fetch() generates — they
    // can contain auth tokens. We keep the URL + method.
    sendDefaultPii:       false,
    beforeSend(event) {
      try {
        if (event.request)     event.request    = scrub(event.request)    as typeof event.request;
        if (event.extra)       event.extra      = scrub(event.extra)      as typeof event.extra;
        if (event.contexts)    event.contexts   = scrub(event.contexts)   as typeof event.contexts;
        if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(b => ({
          ...b,
          data: b.data ? (scrub(b.data) as Record<string, unknown>) : b.data,
        }));
      } catch { /* never let scrubbing crash the report */ }
      return event;
    },
  });
  initialised = true;
}

export const captureException = (e: unknown): void => {
  if (!initialised) return;
  Sentry.captureException(e);
};

export const wrap = Sentry.wrap;
