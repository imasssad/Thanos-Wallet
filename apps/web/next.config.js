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
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://assets.coingecko.com https://raw.githubusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'"
    + " https://rpc.litho.ai https://rpc-2.litho.ai https://rpc-3.litho.ai https://rpc.kamet.litho.ai"
    + " https://bridge.litho.ai"
    + " https://api.coingecko.com"
    + " https://relay.walletconnect.com wss://relay.walletconnect.com wss://relay.walletconnect.org"
    + " https://*.sentry.io"
    + " https://devapp.thanos.fi",
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
    return [
      { source: '/(.*)', headers: SECURITY_HEADERS },
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
