/**
 * Sentry — server-side init for the API service.
 *
 * Mirrors apps/web/sentry.{client,server,edge}.config.ts. Initialises
 * only when SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN) is set, so local
 * dev and CI runs stay quiet.
 *
 * The mnemonic / password / vault scrubbing is identical to the web
 * client: recursive walk of every event and breadcrumb, replacing
 * matching keys with '[redacted]'. Defence-in-depth — Pino's own
 * redact paths already strip these in our log lines.
 */
import * as Sentry from '@sentry/node';

let _initialised = false;

const SCRUB = /(mnemonic|password|seed|private[_-]?key|vault|session[_-]?key|authorization|token)/i;

function scrub<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = Array.isArray(obj) ? [...(obj as never[])] : { ...(obj as Record<string, unknown>) };
  for (const k of Object.keys(out)) {
    if (SCRUB.test(k)) out[k] = '[redacted]';
    else out[k] = scrub(out[k]);
  }
  return out as T;
}

export function initSentry(serviceName: string): void {
  if (_initialised) return;
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment:        process.env.NODE_ENV ?? 'production',
    tracesSampleRate:   Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    profilesSampleRate: 0,
    integrations: [],
    beforeSend(event) { return scrub(event); },
    beforeBreadcrumb(crumb) { return scrub(crumb); },
  });
  Sentry.setTag('service', serviceName);
  _initialised = true;
}

/** Re-export the captureException helper so callers don't import
 *  @sentry/node directly. No-op if Sentry didn't initialise. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!_initialised) return;
  try {
    Sentry.withScope(scope => {
      if (context) scope.setContext('extra', scrub(context));
      Sentry.captureException(err);
    });
  } catch { /* never let telemetry fail a request */ }
}

export const sentryEnabled = (): boolean => _initialised;
