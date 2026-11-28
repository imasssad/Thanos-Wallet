#!/usr/bin/env node
/**
 * Keeps the mobile app's copy of the native Lithic reader in step with its source.
 *
 *   packages/sdk-core/src/clients/native-lithic.ts  →  apps/mobile/lib/native-lithic.ts
 *                                                   →  apps/desktop/src/main/native-lithic.ts
 *
 * Mobile builds on EAS without the pnpm workspace, so it can't import @thanos/sdk-core; the
 * reader depends on ethers only, so mobile gets the same file.
 *
 * The desktop MAIN process can't import it either, for a different reason: tsconfig.main.json
 * scopes rootDir to src/main, so anything outside it is out of the program (TS6059). Its
 * signing sheet decodes Lithic calls, so it gets the same copy.
 *
 *   node scripts/sync-native-lithic.mjs          write the copy
 *   node scripts/sync-native-lithic.mjs --check  exit 1 if the copy differs (CI)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'packages/sdk-core/src/clients/native-lithic.ts';
const COPIES = ['apps/mobile/lib/native-lithic.ts', 'apps/desktop/src/main/native-lithic.ts'];

const expected = `// Copied from ${SRC} by scripts/sync-native-lithic.mjs — edit the original and re-run it.\n${readFileSync(join(ROOT, SRC), 'utf8')}`;
const check = process.argv.includes('--check');
let stale = 0;

for (const copy of COPIES) {
  const target = join(ROOT, copy);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (current === expected) continue;
  if (check) {
    console.error(`${copy} is out of date — run node scripts/sync-native-lithic.mjs`);
    stale++;
  } else {
    writeFileSync(target, expected);
    console.info(`Wrote ${copy}.`);
  }
}

if (check && stale) process.exit(1);
if (!check) console.info(`Native Lithic copies in sync (${COPIES.length}).`);
