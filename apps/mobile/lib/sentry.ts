/**
 * Sentry on the mobile app.
 *
 * Mirrors the web/desktop/extension hookup — only initialises when a DSN
 * is present (via EXPO_PUBLIC_SENTRY_DSN), so local dev + EAS preview
 * builds without the env var stay silent. Every event goes through the
 * same scrub as the web app (lib/telemetry-scrub.ts): secret-named fields
 * (`mnemonic`, `privateKey`, `token`, …), and a recovery phrase or private
 * key quoted inside any string — an error message, a breadcrumb, a URL.
 *
 * Wrap the root component with `Sentry.wrap()` (see App.tsx) to enable
 * automatic crash + JS-error capture. Manual reporting via
 * `captureException(e)` is available for caught-and-handled errors.
 */
import * as Sentry from '@sentry/react-native';
import { scrubOrDropEvent } from './telemetry-scrub';

const DSN     = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';
const ENV     = process.env.EXPO_PUBLIC_ENV       ?? 'production';
const RELEASE = process.env.EXPO_PUBLIC_RELEASE   ?? undefined;

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
    // The whole event, messages and breadcrumbs included; one that can't be
    // scrubbed is dropped, never sent as is.
    beforeSend: scrubOrDropEvent,
    beforeSendTransaction: scrubOrDropEvent,
  });
  initialised = true;
}

export const captureException = (e: unknown): void => {
  if (!initialised) return;
  Sentry.captureException(e);
};

export const wrap = Sentry.wrap;
