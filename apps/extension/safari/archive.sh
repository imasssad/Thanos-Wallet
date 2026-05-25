#!/usr/bin/env bash
#
# Archive + export the Safari Web Extension Xcode project that
# `convert.sh` produced. Runs xcodebuild with codesigning automated when
# the credentials are present in env / .xcconfig; falls back to an
# unsigned archive that can be opened in Xcode manually.
#
# Required env (CI / local with cert installed):
#   APPLE_TEAM_ID                       — 10-char team id
#   SAFARI_BUNDLE_ID                    — defaults to ai.thanos.wallet.safari
#   APPLE_API_KEY_PATH / _ID / _ISSUER  — App Store Connect API key for
#                                         altool-style uploads (optional)
#
# Usage:
#   pnpm --filter @thanos/extension build:safari
#   pnpm --filter @thanos/extension safari:convert
#   bash apps/extension/safari/archive.sh             # archive + export
#
set -euo pipefail

SAFARI_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SAFARI_DIR/xcode"
BUNDLE_ID="${SAFARI_BUNDLE_ID:-ai.thanos.wallet.safari}"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "✗ Xcode project not found at $PROJECT_DIR"
  echo "  Run: pnpm --filter @thanos/extension safari:convert"
  exit 1
fi

cd "$PROJECT_DIR"

XCODE_PROJECT="$(ls *.xcodeproj 2>/dev/null | head -n1 || true)"
if [ -z "$XCODE_PROJECT" ]; then
  echo "✗ No .xcodeproj inside $PROJECT_DIR"
  exit 1
fi

SCHEME="$(basename "$XCODE_PROJECT" .xcodeproj)"
ARCHIVE_PATH="$SAFARI_DIR/build/${SCHEME}.xcarchive"
EXPORT_PATH="$SAFARI_DIR/build/export"
mkdir -p "$SAFARI_DIR/build"

# Write an ExportOptions plist for App Store distribution. If
# APPLE_TEAM_ID is unset, the export step will still run but produce
# an unsigned bundle (suitable for inspection, not submission).
EXPORT_PLIST="$SAFARI_DIR/build/ExportOptions.plist"
cat > "$EXPORT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>           <string>app-store</string>
  <key>signingStyle</key>     <string>automatic</string>
  ${APPLE_TEAM_ID:+<key>teamID</key><string>${APPLE_TEAM_ID}</string>}
  <key>uploadSymbols</key>    <true/>
  <key>compileBitcode</key>   <false/>
</dict>
</plist>
PLIST

echo "→ Archiving ${SCHEME}…"
xcodebuild -project "$XCODE_PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=macOS" \
  ${APPLE_TEAM_ID:+DEVELOPMENT_TEAM=$APPLE_TEAM_ID} \
  CODE_SIGN_STYLE=Automatic \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  archive

echo "→ Exporting archive to App Store-ready .pkg…"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_PLIST" || {
    echo "⚠ Export failed — typically a code-signing cert mismatch."
    echo "  The archive at $ARCHIVE_PATH is intact; open it in Xcode to sign manually."
    exit 0
  }

echo "✓ Done"
echo "  Archive: $ARCHIVE_PATH"
echo "  Export:  $EXPORT_PATH"
echo ""
echo "  Upload with: xcrun altool --upload-app -f \"$EXPORT_PATH\"/*.pkg \\"
echo "    --apiKey \$APPLE_API_KEY_ID --apiIssuer \$APPLE_API_KEY_ISSUER"
