// Metro config for monorepo: lets Metro find node_modules in BOTH the
// project (apps/mobile) and the workspace root.
// https://docs.expo.dev/guides/monorepos/

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot   = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the workspace root so changes propagate
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from BOTH project + workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Disable hierarchical lookup so pnpm symlink trees don't confuse Metro
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
