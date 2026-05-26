#!/usr/bin/env bash
#
# Capture App Store + Play Console screenshots from the mobile app
# running on simulators. Uses xcrun / adb to drive the OS-level
# screenshot tools, not Detox — that keeps the script lean.
#
# Pre-req: a built preview is running on the simulator. Run this AFTER:
#
#   # iOS
#   pnpm --filter @thanos/mobile exec expo run:ios --device "iPhone 16 Pro Max"
#
#   # Android
#   pnpm --filter @thanos/mobile exec expo run:android
#
# The script doesn't drive the UI — that's the human's job for v1 so
# we can iterate on the framing fast. The script grabs the screenshot
# at the size each store expects.
#
# Output:
#   apps/mobile/store-listing/screenshots/ios-6.7/01-dashboard.png
#   apps/mobile/store-listing/screenshots/android-phone/01-dashboard.png
#   etc.

set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_BASE="$MOBILE_DIR/store-listing/screenshots"

step() { printf '\n\033[1;36m→ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }

# Each screen the App Store / Play listings reference, in capture order.
SCREENS=(
  "01-dashboard"
  "02-send"
  "03-swap"
  "04-permissions"
  "05-walletconnect"
  "06-recovery-warning"
)

# ─── iOS ──────────────────────────────────────────────────────────────
capture_ios() {
  local device="$1"
  local out_dir="$2"
  mkdir -p "$out_dir"

  if ! xcrun simctl list devices booted 2>/dev/null | grep -q "$device"; then
    warn "iOS simulator '$device' not booted — skipping"
    return 0
  fi

  step "Capturing iOS screens from '$device' → $out_dir"
  for screen in "${SCREENS[@]}"; do
    read -r -p "  Navigate the simulator to '$screen' and press Enter to capture (or 's' to skip): " a
    [ "$a" = "s" ] && continue
    xcrun simctl io booted screenshot "$out_dir/$screen.png"
    ok "captured $screen.png"
  done
}

capture_ios "iPhone 16 Pro Max" "$OUT_BASE/ios-6.7"
capture_ios "iPhone 11 Pro Max"  "$OUT_BASE/ios-6.5"
capture_ios "iPad Pro (12.9-inch) (6th generation)" "$OUT_BASE/ios-12.9"

# ─── Android ──────────────────────────────────────────────────────────
capture_android() {
  local out_dir="$1"
  if ! command -v adb >/dev/null 2>&1; then
    warn "adb not on PATH — skipping Android capture"
    return 0
  fi
  if ! adb devices | grep -q "device$"; then
    warn "no Android emulator / device attached — skipping"
    return 0
  fi
  mkdir -p "$out_dir"

  step "Capturing Android screens → $out_dir"
  for screen in "${SCREENS[@]}"; do
    read -r -p "  Navigate the device to '$screen' and press Enter to capture (or 's' to skip): " a
    [ "$a" = "s" ] && continue
    adb exec-out screencap -p > "$out_dir/$screen.png"
    ok "captured $screen.png"
  done
}

capture_android "$OUT_BASE/android-phone"

step "Done. PNGs at:"
find "$OUT_BASE" -name '*.png' -print 2>/dev/null | sort
