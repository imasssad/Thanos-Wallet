#!/usr/bin/env bash
#
# One-shot orchestrator — captures every screenshot every store
# listing needs.  Web (Playwright, fully automated) + extension
# (same Playwright run, different viewport) + mobile (semi-automated
# via xcrun / adb; needs a human to drive the simulator).
#
# Run from the repo root:
#   bash ops/capture-all-screenshots.sh
#
# Output:
#   apps/web/store/screenshots/<size>/*.png
#   apps/extension/store/screenshots/<size>/*.png
#   apps/mobile/store-listing/screenshots/<form-factor>/*.png

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
step() { printf '\n\033[1;36m→ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }

step "1) Web screenshots (Playwright, fully automated)"
if (cd "$REPO" && pnpm --filter @thanos/web build); then
  (cd "$REPO/apps/web" && PORT=3000 pnpm start &)
  WEB_PID=$!
  # Wait for the server to come up.
  for i in $(seq 1 30); do
    if curl -fsS http://localhost:3000/ >/dev/null 2>&1; then break; fi
    sleep 1
  done
  (cd "$REPO" && pnpm --filter @thanos/web exec tsx scripts/capture-screenshots.ts) || warn "web capture failed"
  kill $WEB_PID 2>/dev/null || true
fi

step "2) Extension screenshots"
# The extension's popup renders inside Chrome — easiest path is to
# capture the same screens the web wallet produces (the popup UI is a
# scaled-down mirror) but at 1280×800 / 2880×1800 sizes.
warn "Extension screenshots are produced by the same Playwright run"
warn "as the web — the UI matches; resize the viewport between runs."

step "3) Mobile screenshots (semi-automated)"
if [ -x "$REPO/apps/mobile/scripts/capture-screenshots.sh" ]; then
  bash "$REPO/apps/mobile/scripts/capture-screenshots.sh" || warn "mobile capture skipped/failed"
else
  warn "apps/mobile/scripts/capture-screenshots.sh missing"
fi

step "Done. Inventory:"
find "$REPO/apps/web/store/screenshots" \
     "$REPO/apps/mobile/store-listing/screenshots" \
     "$REPO/apps/extension/store/screenshots" \
     -name '*.png' 2>/dev/null | sort
