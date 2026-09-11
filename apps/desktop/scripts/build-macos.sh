#!/usr/bin/env bash
#
# One-shot macOS build for the Thanos Desktop Electron app.
# Run it from a clean checkout on a Mac — no GUI Xcode needed, only the
# Command Line Tools (xcode-select --install). See docs/DESKTOP-MACOS-BUILD.md.
#
# Usage:
#   bash apps/desktop/scripts/build-macos.sh                 # unsigned .dmg, arm64
#   bash apps/desktop/scripts/build-macos.sh --arch x64      # Intel
#   bash apps/desktop/scripts/build-macos.sh --arch both     # arm64 + x64
#   bash apps/desktop/scripts/build-macos.sh --signed        # sign + notarize (needs APPLE_* env)
#   bash apps/desktop/scripts/build-macos.sh --mas           # Mac App Store .pkg (needs certs + profile)
#   bash apps/desktop/scripts/build-macos.sh --skip-install  # reuse node_modules
#
# Signed build expects, in the environment:
#   APPLE_ID                     Apple ID email
#   APPLE_APP_SPECIFIC_PASSWORD  from appleid.apple.com
#   APPLE_TEAM_ID                JEYAFQ92YG
#   (+ a "Developer ID Application" cert in the login keychain, or CSC_LINK/CSC_KEY_PASSWORD)
#
set -euo pipefail

ARCH="arm64"
MODE="unsigned"        # unsigned | signed | mas
SKIP_INSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --arch)         ARCH="${2:-}"; shift 2 ;;
    --signed)       MODE="signed"; shift ;;
    --mas)          MODE="mas"; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    -h|--help)      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)              echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DESKTOP="$REPO_ROOT/apps/desktop"
cd "$REPO_ROOT"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ─── 1. prerequisites ───────────────────────────────────────────────────────
say "Checking prerequisites"

[ "$(uname)" = "Darwin" ] || die "this script builds the macOS artifacts — run it on a Mac"

xcode-select -p >/dev/null 2>&1 || die "Xcode Command Line Tools missing — run: xcode-select --install"

command -v node >/dev/null || die "node not found — install Node 20"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node $NODE_MAJOR is too old — use Node 20"
[ "$NODE_MAJOR" = "20" ] || echo "  ! Node $NODE_MAJOR (CI uses 20 — fine, just noting)"

if ! command -v pnpm >/dev/null; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@9.12.0 --activate >/dev/null 2>&1 || die "pnpm not found and corepack activation failed"
fi
echo "  pnpm $(pnpm --version)"

# node-gyp compiles keccak / blake-hash / tiny-secp256k1 / bigint-buffer from
# source; Python 3.12 dropped distutils, which they import. Force 3.11 if present.
PY311="$(command -v python3.11 || true)"
if [ -z "$PY311" ] && command -v brew >/dev/null; then
  PY311="$(brew --prefix python@3.11 2>/dev/null)/bin/python3.11"
  [ -x "$PY311" ] || PY311=""
fi
if [ -n "$PY311" ]; then
  export npm_config_python="$PY311"
  echo "  node-gyp python: $PY311"
else
  echo "  ! python3.11 not found — if the install step dies on 'distutils', run:"
  echo "      brew install python@3.11 && export npm_config_python=\"\$(brew --prefix python@3.11)/bin/python3.11\""
fi

# ─── 2. install ─────────────────────────────────────────────────────────────
if [ "$SKIP_INSTALL" = "1" ]; then
  say "Skipping dependency install (--skip-install)"
else
  say "Installing workspace dependencies (pnpm install --frozen-lockfile)"
  pnpm install --frozen-lockfile
fi

# ─── 3. build bundle ───────────────────────────────────────────────────────
if [ "$MODE" = "mas" ]; then
  say "Building renderer + main process (MAS_BUILD=1 — HW-wallet UI compiled out)"
  MAS_BUILD=1 pnpm --filter @thanos/desktop build
else
  say "Building renderer + main process"
  pnpm --filter @thanos/desktop build
fi

# ─── 4. package ────────────────────────────────────────────────────────────
cd "$DESKTOP"
VERSION="$(node -p "require('./package.json').version")"

case "$ARCH" in
  arm64) ARCH_FLAGS=(--arm64) ;;
  x64)   ARCH_FLAGS=(--x64) ;;
  both)  ARCH_FLAGS=(--arm64 --x64) ;;
  *)     die "--arch must be arm64 | x64 | both" ;;
esac

# The Mac app's display name is "Thanos" (not "Thanos Wallet") — client
# request, macOS only. Windows/Linux builds (release.yml) keep "Thanos
# Wallet" from electron-builder.yml's top-level productName; this CLI
# override touches only the invocation happening here.
MAC_NAME_FLAG=(--config.productName=Thanos)

case "$MODE" in
  unsigned)
    say "Packaging unsigned .dmg + .zip  (v$VERSION, $ARCH) as \"Thanos\""
    npx electron-builder --mac dmg zip "${ARCH_FLAGS[@]}" --publish never "${MAC_NAME_FLAG[@]}"
    ;;
  signed)
    : "${APPLE_ID:?set APPLE_ID for a signed build}"
    : "${APPLE_APP_SPECIFIC_PASSWORD:?set APPLE_APP_SPECIFIC_PASSWORD for a signed build}"
    : "${APPLE_TEAM_ID:?set APPLE_TEAM_ID for a signed build (JEYAFQ92YG)}"
    say "Packaging signed + notarized .dmg + .zip  (v$VERSION, $ARCH, team $APPLE_TEAM_ID) as \"Thanos\""
    npx electron-builder --mac dmg zip "${ARCH_FLAGS[@]}" --publish never \
      --config.mac.notarize.teamId="$APPLE_TEAM_ID" "${MAC_NAME_FLAG[@]}"
    ;;
  mas)
    say "Packaging Mac App Store .pkg  (v$VERSION) as \"Thanos\" — see docs/DESKTOP-MACOS-APP-STORE.md"
    [ -f build/thanos-mas.provisionprofile ] || \
      die "build/thanos-mas.provisionprofile missing — download the MAS provisioning profile first"
    npx electron-builder --mac mas --publish never "${MAC_NAME_FLAG[@]}"
    ;;
esac

# ─── 5. report ─────────────────────────────────────────────────────────────
say "Done — artifacts in apps/desktop/release/"
ls -lh release/ | grep -E '\.(dmg|zip|pkg)$' || true

if [ "$MODE" = "unsigned" ]; then
  cat <<'NOTE'

Unsigned build: macOS Gatekeeper will block first launch.
  → right-click the app → Open,  or:  xattr -dr com.apple.quarantine "/Applications/Thanos Wallet.app"

This is a LOCAL TEST build. Do not submit to the App Store or publish a
GitHub Release yet (standing client hold — see docs/DESKTOP-MACOS-BUILD.md).
NOTE
fi
