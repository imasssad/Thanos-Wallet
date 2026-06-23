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

// Latest production-apk build — VERSION "thanos-v1.07" (2026-06-24, build
// 009cce29, account imasssadkh). Shows its version in Settings (bottom) so
// testers can confirm the installed build at a glance.
// FIX in v1.07: the onboarding/unlock screen no longer bounces — the RN
// ScrollView is now bounces={false} + overScrollMode="never", so short steps
// (welcome, unlock, password) sit STATIC; the tall 24-word seed step still scrolls.
// From v1.06: the "Requiring unknown module undefined" crash fix (@noble/hashes
// .js subpaths) + resilience guard + centered login/onboarding form.
// From v1.05: external-EVM send/receive/balances (ETH + USDT/USDC, 8 chains).
// From v1.04: ESM-bridge crash fix, reliable biometrics, password-gated reveal,
// BTC real-fee + send-max, account-aware swap/allowances, LIVE MultX bridge.
// NOTE: signed with the SAME imasssadkh keystore as v1.06 — testers on v1.06 can
// upgrade IN-PLACE; only pre-v1.06 installs (different key) must uninstall first.
// The Settings version tag (thanos-v1.07) confirms the new build took.
const APK_URL = 'https://expo.dev/artifacts/eas/8n_0VCvk5imWF3Do_RErxEAnNJPwzmQ43_xBc8uiTQI.apk';
// The downloaded file is named after this so testers can tell the version at a
// glance (was always "thanos.apk"). KEEP IN SYNC with APK_URL on every wire-up.
const APK_VERSION = 'thanos-v1.07';

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
