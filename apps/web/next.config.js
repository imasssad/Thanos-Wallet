/* Content-Security-Policy: see lib/csp.js. The wallet (/app/*) gets a
 * per-request nonce policy from middleware.ts; every other page gets the
 * static one below. */
const { buildCsp } = require('./lib/csp');

const SECURITY_HEADERS = [
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(self "https://widget.lax.money" "https://checkout.lax.money"), microphone=(), geolocation=(self "https://widget.lax.money" "https://checkout.lax.money"), payment=(self "https://widget.lax.money" "https://checkout.lax.money")' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output a self-contained server in .next/standalone — used by the Docker image
  output: 'standalone',
  transpilePackages: ['@thanos/sdk-core', '@thanos/sdk-react', '@thanos/ui'],

  // Baked into the client bundle at BUILD time — UpdateBanner compares this
  // against /api/version (read fresh per request) to detect a newer deploy
  // than the bundle the browser currently has loaded.
  env: { NEXT_PUBLIC_APP_VERSION: require('./package.json').version },

  // Skip type-checking during build (handled by IDE / dev server)
  typescript: { ignoreBuildErrors: true },
  // Skip ESLint during build for the same reason
  eslint:     { ignoreDuringBuilds: true },

  async headers() {
    // T5 — cache the public, non-personalized marketing/legal/docs pages.
    // These routes are statically pre-rendered and identical for every visitor,
    // so a shared cache (nginx proxy_cache / any CDN) can serve the rendered
    // HTML directly: s-maxage caches it 1h and serves it stale for a day while
    // it revalidates; the browser gets a short 60s max-age. Deliberately NOT
    // applied to /app/* (per-user wallet), /api, /rpc or /download (dynamic).
    const CACHE_PUBLIC_PAGE = [{
      key: 'Cache-Control',
      value: 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
    }];
    return [
      { source: '/(.*)',    headers: SECURITY_HEADERS },
      // Everything but the wallet, whose nonce policy middleware.ts sets.
      { source: '/((?!app(?:/|$)).*)', headers: [{ key: 'Content-Security-Policy', value: buildCsp() }] },
      { source: '/',        headers: CACHE_PUBLIC_PAGE },
      { source: '/privacy', headers: CACHE_PUBLIC_PAGE },
      { source: '/docs',    headers: CACHE_PUBLIC_PAGE },
    ];
  },

  /* Same-origin JSON-RPC proxy for the Lithosphere nodes.
   *
   * The upstream RPCs mishandle CORS preflights: an OPTIONS request to
   * rpc.litho.ai / rpc-2 is answered by the Tendermint RPC index page
   * with NO Access-Control-Allow-Origin header (verified 2026-06-12).
   * ethers' JSON-RPC POSTs carry content-type: application/json, which
   * is never a "simple request" — the browser MUST preflight, the
   * preflight fails, and every browser-side Makalu call dies before it
   * leaves the machine. This was the real cause of "can't send but can
   * receive": receives come from the same-origin indexer, sends needed
   * direct RPC. Server-side proxying makes the calls same-origin so no
   * preflight ever happens. (The Ignite team independently hit this and
   * proxies through /v1/rpc/litho for the same reason.) */
  async rewrites() {
    return [
      { source: '/rpc/makalu',   destination: 'https://rpc.litho.ai/' },
      { source: '/rpc/makalu-2', destination: 'https://rpc-2.litho.ai/' },
      { source: '/rpc/kamet',    destination: 'https://rpc-3.litho.ai/' },
      // Apple universal-links manifest for the WalletConnect + Connect/Launch
      // handoff (thanos.fi/wc, thanos.fi/app → Thanos mobile). Internal
      // rewrite, so it's served with the route handler's application/json +
      // no redirect, as Apple requires.
      { source: '/.well-known/apple-app-site-association', destination: '/api/aasa' },
      // Android App Links manifest — same handoff, Android side. Internal
      // rewrite for the same reason (application/json + no redirect).
      { source: '/.well-known/assetlinks.json', destination: '/api/assetlinks' },
    ];
  },

  webpack(config) {
    // tiny-secp256k1 (Bitcoin) ships a .wasm file — enable asyncWebAssembly
    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    // Suppress the wasm module layer warning
    config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';

    return config;
  },
};

// Sentry wrapper — only injected when SENTRY_AUTH_TOKEN is present (i.e. release
// builds in CI). Local dev imports `next` directly and skips source-map upload.
const SENTRY_ENABLED =
  !!process.env.SENTRY_AUTH_TOKEN &&
  !!process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_ENABLED) {
  const { withSentryConfig } = require('@sentry/nextjs');
  module.exports = withSentryConfig(nextConfig, {
    org:           process.env.SENTRY_ORG     || 'thanos',
    project:       process.env.SENTRY_PROJECT || 'thanos-wallet-web',
    authToken:     process.env.SENTRY_AUTH_TOKEN,
    silent:        true,
    widenClientFileUpload: true,
    hideSourceMaps: true,
    disableLogger: true,
  });
} else {
  module.exports = nextConfig;
}
