/**
 * Android Digital Asset Links (App Links).
 *
 * Serves the manifest so Android opens the Thanos mobile app instead of
 * Chrome for https://thanos.fi/wc?uri=… (the WalletConnect handoff) and
 * https://thanos.fi/app (any "Connect"/"Launch wallet" link that used to
 * land on the web wallet even when the native app is installed). A
 * next.config rewrite maps the canonical path `/.well-known/assetlinks.json`
 * here, so it's delivered as application/json with NO redirect — both
 * Android requirements.
 *
 * sha256_cert_fingerprints identifies WHICH signing key's APKs this
 * association covers. Today that's only the local upload keystore
 * (credentials/android-upload.jks) used for the direct-download APK — the
 * app has never been published to Google Play. If/when it is, Play App
 * Signing re-signs with GOOGLE'S OWN key, and that key's fingerprint must be
 * ADDED here too (as a second array entry) or App Links won't verify for
 * copies installed from the Play Store. Get it from Play Console ->
 * Setup -> App signing -> "App signing key certificate" SHA-256, once the
 * app is published there.
 */

export const dynamic = 'force-dynamic';

const ANDROID_PACKAGE = 'ai.thanos.wallet';

// android-upload.jks (the direct-download APK's signing key). Verified via
// two independent methods (manual SHA-256 + Node's X509Certificate API) when
// extracted 2026-08-19 — do not edit without re-verifying from the keystore.
const UPLOAD_KEY_SHA256 =
  '4A:EA:06:A5:CD:ED:88:D6:8E:95:19:9B:96:31:E4:EA:A2:74:63:EB:F2:A3:23:46:0F:FA:28:A9:05:26:4B:F5';

export function GET() {
  const body = JSON.stringify([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: [UPLOAD_KEY_SHA256],
      },
    },
  ]);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
