/* Content-Security-Policy for the wallet UI.
 *
 * Tight allow-list: only domains we actually call. Edit when adding a new
 * upstream (e.g. a new RPC, a new bridge).
 *
 *  - script-src 'unsafe-inline' is needed for Next's bootstrap chunk.
 *    Move to nonces if/when we tighten further.
 *  - 'wasm-unsafe-eval' lets tiny-secp256k1, hash-wasm + WalletConnect's
 *    crypto load their .wasm modules.
 *  - connect-src includes RPC, indexer, bridge, CoinGecko, Reown, Sentry.
 *  - img-src includes the CoinGecko CDN we use for live token logos.
 *  - frame-ancestors 'none' prevents clickjacking of the wallet inside an
 *    <iframe>.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  // qr-scanner decodes in a Worker it spawns from a blob: URL (its own bundled
  // code, see createObjectURL in qr-scanner.umd.min.js). With default-src 'self'
  // and no worker-src, that worker is BLOCKED — so the camera opens but the QR
  // never decodes and the scan just times out. Allow same-origin + blob:
  // workers (child-src is the fallback older Safari consults for workers).
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:"
    // CoinGecko serves token logos from BOTH hosts — /coins/markets returns
    // coin-images.coingecko.com URLs (verified live 2026-06-11).
    + " https://assets.coingecko.com"
    + " https://coin-images.coingecko.com"
    + " https://raw.githubusercontent.com"
    + " https://dl.dropboxusercontent.com"
    + " https://www.dropbox.com"
    + " https://makalu.litho.ai"
    + " https://explorer.solana.com",
  "font-src 'self' data:",
  "connect-src 'self'"
    // Lithosphere RPCs. Makalu: rpc.litho.ai / rpc-2. Kamet: rpc-3 (REST
    // api-3). rpc-3 sends no CORS headers, so browser Kamet traffic goes
    // through the same-origin proxy (/rpc/kamet, 'self') — rpc-3 is listed
    // only for the server-side proxy target + any direct server callers.
    + " https://rpc.litho.ai https://rpc-2.litho.ai https://rpc-3.litho.ai https://api-3.litho.ai"
    + " https://bridge.litho.ai"
    + " https://ignite.litho.ai"
    + " https://api.coingecko.com"
    // Display-currency FX rates (sdk-core/fx.ts → USD→EUR/GBP/JPY/BTC).
    // WITHOUT this the browser blocks the rate fetch, the engine falls back to
    // USD exactly as designed ("never show wrong math"), and the Settings
    // Currency picker silently appears to do nothing. The native apps have no
    // CSP, which is why this only ever broke on web.
    + " https://api.coinbase.com"
    // Multi-chain balance/send upstreams the lib/ clients actually call.
    + " https://mempool.space"
    + " https://api.mainnet-beta.solana.com"
    + " https://cosmos-rpc.publicnode.com https://cosmos-rest.publicnode.com"
    + " https://ethereum.publicnode.com https://eth.merkle.io"
    + " https://bsc-dataseed.binance.org"
    + " https://polygon-bor-rpc.publicnode.com https://api.avax.network"
    + " https://arb1.arbitrum.io https://mainnet.optimism.io https://mainnet.base.org https://rpc.linea.build"
    + " https://relay.walletconnect.com wss://relay.walletconnect.com wss://relay.walletconnect.org"
    + " https://*.sentry.io"
    + " https://thanos.fi",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy',   value: CSP },
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output a self-contained server in .next/standalone — used by the Docker image
  output: 'standalone',
  transpilePackages: ['@thanos/sdk-core', '@thanos/sdk-react', '@thanos/ui'],

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
      // Apple universal-links manifest for the WalletConnect handoff
      // (thanos.fi/wc → Thanos mobile). Internal rewrite, so it's served with
      // the route handler's application/json + no redirect, as Apple requires.
      { source: '/.well-known/apple-app-site-association', destination: '/api/aasa' },
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
