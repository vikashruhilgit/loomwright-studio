#!/usr/bin/env bash
# Regenerates build/icon.icns (the packaged app's Dock and Finder icon).
# build/icon.png is rendered by scripts/icon-render.py (needs python3 with numpy and Pillow).
# macOS only: uses sips and iconutil, both part of the OS and Xcode tools.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/icon-render.py
set_dir="$(mktemp -d)/icon.iconset"
mkdir -p "$set_dir"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" build/icon.png --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) build/icon.png --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$set_dir" -o build/icon.icns
echo "wrote build/icon.icns"
