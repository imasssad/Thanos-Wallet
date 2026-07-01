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

// Latest production-apk build — VERSION "thanos-v1.11" (2026-07-01, build
// 54e55adb, account imasssadkh). Shows its version in Settings (bottom) so
// testers can confirm the installed build at a glance.
// NEW in v1.11: premium minimal-luxe onboarding (welcome + unlock), LAX +
// Quantt cards on Home, cached-first render + skeleton screens, optimistic
// pending-tx + address book, and a dark-themed account switcher (replaces the
// OS white Alert). Build fix: JitPack promoted to a settings-level Maven repo
// so the WalletConnect-Pay 'yttrium' native dep resolves (was 504-ing on
// Sonatype snapshots).
// FIX in v1.10 (crash): v1.09 crashed on unlock with "Rendered more hooks than
// during the previous render" — the walletAddr useMemo sat BELOW App's early
// returns (boot splash / unlock gate), so it ran only in the unlocked branch =
// a changing hook count. Moved the memo above the early returns.
// From v1.09 (performance + font): the "blank for minutes after login" stall
// is fixed — fetchEcosystemPrices times out at 6s; legacy Argon2id vaults
// re-encrypt to a calibrated PBKDF2 vault after one unlock (minutes -> ~0.6s);
// walletAddr memoized; bottom tabs have instant press feedback; argon2/qrcode/
// tx-simulator lazy-load off cold start. Brand font is Satoshi.
// From v1.08: Home native-chain derivers gated off the portfolio path.
// From v1.05: external-EVM send/receive/balances (ETH + USDT/USDC, 8 chains).
// NOTE: signed with the SAME imasssadkh keystore — testers on v1.06+ upgrade
// IN-PLACE; only pre-v1.06 installs (different key) must uninstall first.
// The Settings version tag (thanos-v1.11) confirms the new build took.
const APK_URL = 'https://expo.dev/artifacts/eas/FUiDAOMGl1Gr6tOdYHLbfQMN3N5R9pmPG8txCrjqVcc.apk';
// The downloaded file is named after this so testers can tell the version at a
// glance (was always "thanos.apk"). KEEP IN SYNC with APK_URL on every wire-up.
const APK_VERSION = 'thanos-v1.11';

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
