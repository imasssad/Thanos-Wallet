#!/usr/bin/env node
/**
 * Keeps the mobile app's copy of the native Lithic reader in step with its source.
 *
 *   packages/sdk-core/src/clients/native-lithic.ts  →  apps/mobile/lib/native-lithic.ts
 *
 * Mobile builds on EAS without the pnpm workspace, so it can't import @thanos/sdk-core; the
 * reader depends on ethers only, so mobile gets the same file.
 *
 *   node scripts/sync-native-lithic.mjs          write the copy
 *   node scripts/sync-native-lithic.mjs --check  exit 1 if the copy differs (CI)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'packages/sdk-core/src/clients/native-lithic.ts';
const MOBILE = 'apps/mobile/lib/native-lithic.ts';

const expected = `// Copied from ${SRC} by scripts/sync-native-lithic.mjs — edit the original and re-run it.\n${readFileSync(join(ROOT, SRC), 'utf8')}`;
const target = join(ROOT, MOBILE);
const current = existsSync(target) ? readFileSync(target, 'utf8') : null;

if (process.argv.includes('--check')) {
  if (current !== expected) {
    console.error(`${MOBILE} is out of date — run node scripts/sync-native-lithic.mjs`);
    process.exit(1);
  }
} else {
  if (current !== expected) writeFileSync(target, expected);
  console.info('Mobile native Lithic copy written.');
}
