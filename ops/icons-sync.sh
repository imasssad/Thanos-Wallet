#!/usr/bin/env bash
#
# Token-icon sync — drop a PNG once, fan out to all 4 client paths.
#
# Usage:
#   bash ops/icons-sync.sh path/to/colle.png         # auto-detects name from filename
#   bash ops/icons-sync.sh path/to/whatever.png hype # explicit symbol override
#
# What it does:
#   1. Auto-crops transparent padding so the design fills the canvas
#      (kills the COLLE-style "icon floats inside its container" bug).
#   2. Re-squares + downsizes to 512x512 PNG.
#   3. Writes to all four client token directories so the same PNG
#      appears on web, desktop, extension, and mobile.
#   4. Reminds you to wire the symbol into the BUNDLED_ICONS maps if
#      it's not already there.
#
# Requires Pillow:
#   pip install Pillow
#
# Notes:
#   - This script is idempotent. Running it twice produces the same
#     output as running it once.
#   - The symbol used for the destination filename is lowercased.

set -euo pipefail

SRC="${1:?usage: bash ops/icons-sync.sh <path-to-png> [symbol]}"
SYM="${2:-$(basename "$SRC" .png)}"
SYM_LOWER="$(echo "$SYM" | tr '[:upper:]' '[:lower:]')"

if [ ! -f "$SRC" ]; then
  echo "✗ source file not found: $SRC" >&2
  exit 1
fi

if ! command -v python >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
  echo "✗ python not found — install python + Pillow first" >&2
  exit 1
fi

PYBIN="$(command -v python3 || command -v python)"

PYTHONIOENCODING=utf-8 "$PYBIN" - "$SRC" "$SYM_LOWER" <<'PY'
import sys
from pathlib import Path
from PIL import Image

src_path = Path(sys.argv[1])
sym = sys.argv[2]

TARGETS = [
    "apps/web/public/images/tokens",
    "apps/desktop/public/images/tokens",
    "apps/extension/public/images/tokens",
    "apps/mobile/assets/images/tokens",
]

img = Image.open(src_path).convert("RGBA")
w, h = img.size

# 1. Auto-crop transparent padding.
alpha = img.split()[-1]
bbox = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
if bbox:
    x0, y0, x1, y1 = bbox
    cropped = img.crop(bbox)
    cw, ch = x1 - x0, y1 - y0
    side = max(cw, ch)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(cropped, ((side - cw) // 2, (side - ch) // 2), cropped)
    img = canvas

# 2. Down/up-size to 512x512 (consistent target across the four clients).
final = img.resize((512, 512), Image.LANCZOS)

# 3. Write to all four client paths.
for t in TARGETS:
    d = Path(t)
    d.mkdir(parents=True, exist_ok=True)
    final.save(d / f"{sym}.png", "PNG")
    print(f"  {d}/{sym}.png")
PY

echo
echo "✓ $SYM_LOWER.png distributed to 4 client paths at 512x512."
echo
echo "If $SYM_LOWER is a new symbol, also add it to the resolver maps:"
echo "  apps/desktop/src/renderer/main.tsx        (BUNDLED_ICONS)"
echo "  apps/extension/src/entrypoints/popup/main.tsx  (BUNDLED_ICONS)"
echo "  apps/mobile/lib/token-icons.ts            (BUNDLED)"
echo "  apps/web/lib/tokens.ts                    (TOKENS[].icon — for static-list tokens)"
