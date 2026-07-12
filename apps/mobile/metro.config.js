// Metro config — apps/mobile is workspace-DETACHED and is built in isolation
// on EAS (only this folder is uploaded), so it must NOT reference the monorepo
// root (../.. doesn't exist there). The Expo default resolves from
// apps/mobile/node_modules with normal hierarchical (nested) lookup, which is
// REQUIRED so nested dependency copies resolve — e.g. @solana/web3.js's own
// @noble/hashes@1 (which has the /sha256 subpath) is distinct from the app's
// top-level @noble/hashes@2 (which uses /sha2). The previous config watched
// the workspace root and disabled hierarchical lookup (a pnpm-era workaround);
// that broke both the standalone build and the nested @noble resolution.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// SDK 53 turned Metro's package-exports resolution ON by default (SDK 52:
// OFF). The vc5/vc6 bundle logs are full of exports-related WARNs across the
// crypto stack (nested @noble/hashes/crypto.js via ethers/solana/cosmjs/
// walletconnect, uint8arrays, rpc-websockets) and both store builds crash at
// launch during bundle eval — before React mounts, which is why the in-app
// ErrorBoundary/CrashScreen never appears. Exports maps silently resolve
// Node/browser entrypoints instead of the React Native files SDK 52's
// file-based resolution picked. Restore the resolution semantics every
// working release (v1.05–v1.13) shipped with.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
