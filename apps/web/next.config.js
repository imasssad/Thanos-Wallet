/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output a self-contained server in .next/standalone — used by the Docker image
  output: 'standalone',
  transpilePackages: ['@thanos/sdk-core', '@thanos/sdk-react', '@thanos/ui'],

  // Skip type-checking during build (handled by IDE / dev server)
  typescript: { ignoreBuildErrors: true },
  // Skip ESLint during build for the same reason
  eslint:     { ignoreDuringBuilds: true },

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
