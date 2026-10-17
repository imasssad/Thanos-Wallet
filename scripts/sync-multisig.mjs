#!/usr/bin/env node
/**
 * Keeps the mobile app's copy of the Thanos MultiSig core in step with its source.
 *
 *   packages/multisig/src/*.ts  →  apps/mobile/lib/multisig/
 *
 * Mobile builds on EAS without the pnpm workspace, so it can't depend on @thanos/multisig; it
 * gets the same files (the React DOM screens in src/react stay behind — mobile has its own in
 * components/multisig). The Litho Vault SDK both use is the same vendored .tgz.
 *
 *   node scripts/sync-multisig.mjs          write the copy
 *   node scripts/sync-multisig.mjs --check  exit 1 if the copy differs (CI)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'packages/multisig/src');
const MOBILE = join(ROOT, 'apps/mobile/lib/multisig');
const SDK = 'vendor/litho-vault-sdk-1.0.0.tgz';

const sources = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort();
const expected = new Map(
  sources.map((f) => [f, `// Copied from packages/multisig/src/${f} by scripts/sync-multisig.mjs — edit the original and re-run it.\n${readFileSync(join(SRC, f), 'utf8')}`]),
);

const check = process.argv.includes('--check');
const drift = [];
for (const [file, content] of expected) {
  const target = join(MOBILE, file);
  if (existsSync(target) && readFileSync(target, 'utf8') === content) continue;
  if (check) drift.push(relative(ROOT, target));
  else {
    mkdirSync(MOBILE, { recursive: true });
    writeFileSync(target, content);
  }
}
for (const file of existsSync(MOBILE) ? readdirSync(MOBILE) : []) {
  if (expected.has(file)) continue;
  if (check) drift.push(`${relative(ROOT, join(MOBILE, file))} (stale)`);
  else rmSync(join(MOBILE, file));
}
// Both apps must vendor the same SDK build.
const shared = readFileSync(join(ROOT, SDK));
const mobileSdk = join(ROOT, 'apps/mobile', SDK);
if (!existsSync(mobileSdk) || !readFileSync(mobileSdk).equals(shared)) {
  if (check) drift.push(`apps/mobile/${SDK} (differs from ${SDK})`);
  else writeFileSync(mobileSdk, shared);
}

if (check && drift.length) {
  console.error(`The mobile MultiSig copy is out of date — run node scripts/sync-multisig.mjs:\n  ${drift.join('\n  ')}`);
  process.exit(1);
}
if (!check) console.info('Mobile MultiSig copy written.');
