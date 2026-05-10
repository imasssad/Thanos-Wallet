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

module.exports = nextConfig;
