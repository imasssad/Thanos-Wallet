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

module.exports = config;
