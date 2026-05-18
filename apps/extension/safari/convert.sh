#!/usr/bin/env bash
#
# Convert the WXT Safari build into an Xcode Safari Web Extension project.
#
# Safari extensions can't be loaded as a raw folder like Chrome — they must
# be wrapped in a macOS/iOS app via Apple's safari-web-extension-converter,
# then built + signed in Xcode. This script runs the converter; the Xcode
# steps after it are in safari/README.md.
#
# Requirements: macOS + Xcode (provides `xcrun safari-web-extension-converter`).
#
# Usage:
#   pnpm --filter @thanos/extension build:safari   # produce .output/safari-mv2
#   pnpm --filter @thanos/extension safari:convert  # this script
#
set -euo pipefail

EXT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$EXT_DIR/.output/safari-mv2"
PROJECT_DIR="$EXT_DIR/safari/xcode"

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "✗ safari-web-extension-converter not found — this step needs macOS + Xcode."
  exit 1
fi

if [ ! -d "$BUILD_DIR" ]; then
  echo "✗ No Safari build at $BUILD_DIR"
  echo "  Run first: pnpm --filter @thanos/extension build:safari"
  exit 1
fi

echo "→ Converting $BUILD_DIR → Xcode project at $PROJECT_DIR"
xcrun safari-web-extension-converter "$BUILD_DIR" \
  --project-location "$PROJECT_DIR" \
  --app-name "Thanos Wallet" \
  --bundle-identifier "ai.thanos.wallet.safari" \
  --swift \
  --no-open \
  --force

echo ""
echo "✓ Xcode project generated at safari/xcode/"
echo "  Next: open it in Xcode, set your Team + bundle IDs, then build/archive."
echo "  Full steps: apps/extension/safari/README.md"
