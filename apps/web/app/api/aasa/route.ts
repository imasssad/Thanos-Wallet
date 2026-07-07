/**
 * Apple App Site Association (AASA).
 *
 * Serves the universal-link manifest so iOS opens the Thanos mobile app for
 * https://thanos.fi/wc?uri=… (the WalletConnect handoff). A next.config rewrite
 * maps the canonical path `/.well-known/apple-app-site-association` here, so it's
 * delivered as application/json with NO redirect — both Apple requirements.
 *
 * The appID is `<APPLE_TEAM_ID>.ai.thanos.wallet`. The 10-char team id is read
 * from the APPLE_TEAM_ID env var (the same one apps/mobile/eas.json uses) at
 * request time — set it in the VPS `.env`. Until it's set, the manifest is valid
 * JSON with an empty `details`, so nothing breaks; the universal link simply
 * doesn't activate yet (the `thanoswallet://wc?uri=` custom scheme works either
 * way and needs no server setup).
 */

// Read the env at request time (not baked at build) so setting APPLE_TEAM_ID on
// the VPS takes effect without a rebuild.
export const dynamic = 'force-dynamic';

const IOS_BUNDLE_ID = 'ai.thanos.wallet';

export function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const details = teamId
    ? [{ appID: `${teamId}.${IOS_BUNDLE_ID}`, paths: ['/wc', '/wc/*'] }]
    : [];

  const body = JSON.stringify({ applinks: { apps: [], details } });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
