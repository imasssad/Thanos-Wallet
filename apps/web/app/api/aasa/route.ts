/**
 * Apple App Site Association (AASA).
 *
 * Serves the universal-link manifest so iOS opens the Thanos mobile app for
 * https://thanos.fi/wc?uri=… (the WalletConnect handoff). A next.config rewrite
 * maps the canonical path `/.well-known/apple-app-site-association` here, so it's
 * delivered as application/json with NO redirect — both Apple requirements.
 *
 * The appID is `<APPLE_TEAM_ID>.ai.thanos.wallet`. The team id defaults to
 * KaJ Labs LLC's Apple Developer Program team (JEYAFQ92YG, provided 2026-07-13);
 * the APPLE_TEAM_ID env var still overrides it if the account ever changes.
 * Team IDs are public by design (every AASA file on the internet exposes one).
 */

// Read the env at request time (not baked at build) so overriding APPLE_TEAM_ID
// on the VPS takes effect without a rebuild.
export const dynamic = 'force-dynamic';

const IOS_BUNDLE_ID = 'ai.thanos.wallet';
const DEFAULT_TEAM_ID = 'JEYAFQ92YG'; // KaJ Labs LLC — Apple Developer Program (Organization)

export function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim() || DEFAULT_TEAM_ID;
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
