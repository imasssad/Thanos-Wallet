#!/usr/bin/env bash
#
# Post-build signing verification — run after `pnpm dist` to confirm
# the artifacts can be installed on a clean macOS / Windows machine
# without Gatekeeper / SmartScreen complaints.
#
# Usage:
#   bash apps/desktop/scripts/verify-signing.sh            # auto-detect
#   bash apps/desktop/scripts/verify-signing.sh /path.dmg  # explicit path
#
set -euo pipefail

ARTIFACT="${1:-}"
DIST="$(cd "$(dirname "$0")/.." && pwd)/dist-electron"

if [ -z "$ARTIFACT" ]; then
  # Auto-detect — pick the newest .dmg, .exe, or .zip in dist-electron.
  ARTIFACT=$(find "$DIST" -maxdepth 2 -type f \( -name '*.dmg' -o -name '*.exe' -o -name '*.AppImage' \) -printf '%T@ %p\n' 2>/dev/null \
             | sort -rn | head -1 | cut -d' ' -f2- || true)
fi
[ -n "$ARTIFACT" ] && [ -f "$ARTIFACT" ] || { echo "no artifact found — run \`pnpm dist\` first"; exit 1; }

EXT="${ARTIFACT##*.}"
echo "→ Verifying $ARTIFACT"

case "$EXT" in
  dmg)
    if ! command -v spctl >/dev/null; then
      echo "  spctl missing — run on macOS or skip this check"; exit 0
    fi
    MOUNT=$(mktemp -d)
    hdiutil attach -nobrowse -mountpoint "$MOUNT" "$ARTIFACT" >/dev/null
    APP=$(find "$MOUNT" -maxdepth 2 -name '*.app' | head -1)
    if [ -z "$APP" ]; then echo "  ✗ no .app inside dmg"; hdiutil detach "$MOUNT" >/dev/null; exit 1; fi
    echo "  → codesign --verify --deep --strict"
    if codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | grep -E 'valid on disk|satisfies its Designated Requirement'; then
      echo "  ✓ codesign passes"
    else
      echo "  ✗ codesign failed — app is unsigned or signature is invalid"
    fi
    echo "  → spctl --assess (Gatekeeper)"
    if spctl --assess --type execute --verbose "$APP" 2>&1 | grep -q 'accepted'; then
      echo "  ✓ Gatekeeper accepts (notarized + signed)"
    else
      echo "  ⚠ Gatekeeper rejected — either not notarized or signed with a non-Developer-ID cert"
    fi
    hdiutil detach "$MOUNT" >/dev/null
    ;;
  exe)
    if command -v signtool.exe >/dev/null 2>&1 || command -v signtool >/dev/null 2>&1; then
      SIGNTOOL=$(command -v signtool.exe || command -v signtool)
      "$SIGNTOOL" verify /pa /v "$ARTIFACT" && echo "  ✓ signtool: signature is valid" || echo "  ✗ signtool: unsigned or invalid"
    elif command -v osslsigncode >/dev/null 2>&1; then
      osslsigncode verify "$ARTIFACT" && echo "  ✓ osslsigncode: signature is valid" || echo "  ✗ osslsigncode: unsigned or invalid"
    else
      echo "  signtool / osslsigncode missing — install one to verify on Linux/Mac"
      echo "    Linux: apt install osslsigncode"
      echo "    Mac:   brew install osslsigncode"
    fi
    ;;
  AppImage)
    echo "  AppImages aren't typically codesigned; verifying SHA-256 sidecar"
    [ -f "$ARTIFACT.sha256" ] && sha256sum -c "$ARTIFACT.sha256" || echo "  no sidecar"
    ;;
  *) echo "  unknown artifact type: $EXT"; exit 1 ;;
esac
