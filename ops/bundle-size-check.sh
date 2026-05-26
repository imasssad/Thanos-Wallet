#!/usr/bin/env bash
#
# Bundle-size budget enforcement. Run after a build to catch
# accidental dep bloat before it ships.
#
# Budgets are intentionally generous — they trip when a single PR
# adds >25% to a bundle, not on routine drift.
#
# Run from the repo root after `pnpm --filter @thanos/{web,extension,desktop} build`:
#   bash ops/bundle-size-check.sh
#
# Exits 1 if any bundle blows its budget; CI gates on the exit code.

set -uo pipefail

# Budget map: path glob → max size in MB (uncompressed).
declare -A BUDGETS
# Extension popup — the user-facing entry; wallet UX needs to feel
# instant. 3 MB is generous (current is ~2.2 MB).
BUDGETS["apps/extension/.output/chrome-mv3/chunks/popup-*.js"]=3.0
# Offscreen kit — runs out-of-band, less critical.
BUDGETS["apps/extension/.output/chrome-mv3/chunks/offscreen-*.js"]=1.5
# Desktop renderer — Electron pre-loads it; budget is looser.
BUDGETS["apps/desktop/dist/assets/index-*.js"]=5.0
# Web app — split into many chunks via Next.js; check the largest single chunk only.
BUDGETS["apps/web/.next/static/chunks/main-*.js"]=2.0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0
ok=0

step() { printf "\n\033[1m%s\033[0m\n" "$1"; }

for glob in "${!BUDGETS[@]}"; do
  budget_mb="${BUDGETS[$glob]}"
  budget_bytes=$(awk "BEGIN{print int($budget_mb * 1024 * 1024)}")

  matched=$(ls -1 $glob 2>/dev/null || true)
  if [ -z "$matched" ]; then
    printf "\033[1;33m  ? %-58s no matching files (build first?)\033[0m\n" "$glob"
    continue
  fi

  while read -r f; do
    [ -z "$f" ] && continue
    size=$(stat -c '%s' "$f" 2>/dev/null || wc -c < "$f")
    size_mb=$(awk "BEGIN{printf \"%.2f\", $size / 1024 / 1024}")
    name=$(basename "$f")
    if [ "$size" -le "$budget_bytes" ]; then
      printf "\033[1;32m  ✓ %-58s %6.2f MB  (budget %.1f MB)\033[0m\n" "$name" "$size_mb" "$budget_mb"
      ((ok++))
    else
      over=$(awk "BEGIN{printf \"%.0f\", ($size - $budget_bytes) / 1024}")
      printf "\033[1;31m  ✗ %-58s %6.2f MB  (budget %.1f MB, over by %s KB)\033[0m\n" "$name" "$size_mb" "$budget_mb" "$over"
      ((fail++))
    fi
  done <<< "$matched"
done

printf "\n\033[1mSummary\033[0m  \033[1;32m✓ %d\033[0m  \033[1;31m✗ %d\033[0m\n" "$ok" "$fail"

if [ "$fail" -gt 0 ]; then
  cat <<'NOTE'

A bundle blew its budget. Common fixes:
  - Lazy-import the heavy dep (see existing `await import('./...')`
    pattern in apps/web/components/modals.tsx for swap clients)
  - Tree-shake unused exports (`sideEffects: false` in package.json)
  - Move the dep into a vendor chunk via apps/desktop/vite.config.ts
    manualChunks
  - Genuinely need the size? Bump the budget in ops/bundle-size-check.sh
    — but explain why in the commit message.

NOTE
  exit 1
fi

exit 0
