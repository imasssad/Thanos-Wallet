#!/usr/bin/env node
/**
 * Keeps the MultX bridge code the wallets run in step with its source.
 *
 *   packages/multx-adapter/src/*.ts  →  packages/sdk-core/src/multx-thanos/adapter/
 *   packages/sdk-core/src/multx-thanos/  →  apps/mobile/lib/multx-thanos/
 *
 * sdk-core is consumed from source and can't import another package's src;
 * mobile builds on EAS without the workspace. Both get copies — import
 * specifiers lose their `.js` (Metro doesn't map `./x.js` to `./x.ts`).
 *
 *   node scripts/sync-multx-thanos.mjs          write the copies
 *   node scripts/sync-multx-thanos.mjs --check  exit 1 if any copy differs
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER_SRC = join(ROOT, 'packages/multx-adapter/src');
const CORE_DIR = join(ROOT, 'packages/sdk-core/src/multx-thanos');
const MOBILE_DIR = join(ROOT, 'apps/mobile/lib/multx-thanos');

const isSource = (f) => f.endsWith('.ts') && !f.endsWith('.test.ts');

function adapterCopy(file) {
  const src = readFileSync(join(ADAPTER_SRC, file), 'utf8');
  const body = src.replace(/(from\s+'\.{1,2}\/[^']+?)\.js'/g, "$1'");
  return `// Copied from packages/multx-adapter/src/${file} by scripts/sync-multx-thanos.mjs — edit the original and re-run it.\n${body}`;
}

/** Every file the copies should hold: path relative to the target root → content. */
function expected() {
  const core = new Map();
  for (const f of readdirSync(ADAPTER_SRC).filter(isSource).sort()) core.set(`adapter/${f}`, adapterCopy(f));
  const mobile = new Map(core);
  for (const f of readdirSync(CORE_DIR).filter(isSource).sort()) {
    mobile.set(f, readFileSync(join(CORE_DIR, f), 'utf8'));
  }
  return [[CORE_DIR, core, 'adapter'], [MOBILE_DIR, mobile, null]];
}

/** Files under `dir` (relative), limited to `sub` when given. */
function existing(dir, sub) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (isSource(e.name)) out.push(relative(dir, p));
    }
  };
  walk(sub ? join(dir, sub) : dir);
  return out;
}

const check = process.argv.includes('--check');
const drift = [];
for (const [dir, files, sub] of expected()) {
  for (const [rel, content] of files) {
    const target = join(dir, rel);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current === content) continue;
    if (check) drift.push(relative(ROOT, target));
    else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); }
  }
  for (const rel of existing(dir, sub)) {
    if (files.has(rel)) continue;
    if (check) drift.push(`${relative(ROOT, join(dir, rel))} (stale)`);
    else rmSync(join(dir, rel));
  }
}

if (check && drift.length) {
  console.error(`MultX copies are out of date — run node scripts/sync-multx-thanos.mjs:\n  ${drift.join('\n  ')}`);
  process.exit(1);
}
if (!check) console.info('MultX copies written.');
