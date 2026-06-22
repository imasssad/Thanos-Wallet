/**
 * thanos.fi/download — branded Android APK download.
 *
 * Streams the current EAS build artifact back to the browser with a
 * Content-Disposition of `thanos.apk`, so the file always saves under a
 * clean, professional name instead of EAS's `application-<uuid>.apk`. We
 * proxy (not redirect) because the `download` attribute / filename can't be
 * forced on a cross-origin URL — the server has to set the header itself.
 *
 * Update APK_URL whenever a fresh production-apk build lands
 * (eas build:view <id> → "Application Archive URL").
 */

// Latest production-apk build — VERSION "thanos-v1.06" (2026-06-22, commit
// 435e5f7 / build ccee5d54, account imasssadkh). Shows its version in Settings
// (bottom) so testers can confirm the installed build at a glance.
// FIX in v1.06: the "Requiring unknown module undefined" crash — solana.ts
// required @noble/hashes bare subpaths that v2.2.0 dropped from its exports
// map; now uses the .js subpaths. Plus a resilience guard (a failed optional
// lazy-load no longer bricks the wallet) and the centered login/onboarding form.
// From v1.05: external-EVM send/receive/balances (ETH + USDT/USDC, 8 chains).
// From v1.04: ESM-bridge crash fix, reliable biometrics, password-gated reveal,
// BTC real-fee + send-max, account-aware swap/allowances, LIVE MultX bridge.
// NOTE: signed with the imasssadkh keystore — testers must uninstall any prior
// Thanos build before installing (Android signature mismatch); the Settings
// version tag (thanos-v1.06) then confirms the new build took.
const APK_URL = 'https://expo.dev/artifacts/eas/rE9KbzLExGbexDAgMyBVsQz2TW9vcHqdImUtfny4ps8.apk';
// The downloaded file is named after this so testers can tell the version at a
// glance (was always "thanos.apk"). KEEP IN SYNC with APK_URL on every wire-up.
const APK_VERSION = 'thanos-v1.06';

// Always reflect the current APK_URL (no stale cache during active builds);
// the stream itself is the heavy part, not the route resolution.
export const dynamic = 'force-dynamic';

export async function GET() {
  const upstream = await fetch(APK_URL, { cache: 'no-store' });
  if (!upstream.ok || !upstream.body) {
    return new Response('APK temporarily unavailable — please try again shortly.', {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const headers = new Headers({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${APK_VERSION}.apk"`,
    // Let Cloudflare edge-cache the binary so we don't re-proxy every hit;
    // purge the /download cache (or wait 1h) after shipping a new build.
    'Cache-Control': 'public, max-age=3600',
  });
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);

  // Stream the upstream body straight through — no 40 MB buffer in memory.
  return new Response(upstream.body, { status: 200, headers });
}
