#!/usr/bin/env bash
# Build the VANTAGE Orecchino receiver and, with --port, flash it.
#   plugins/drones/orecchino/flash.sh                         build only
#   plugins/drones/orecchino/flash.sh --port /dev/cu.usbmodem101
set -euo pipefail

ORECCHINO_REPO="https://github.com/isaacbentley/orecchino-esp32.git"
ORECCHINO_REF="8cd2662371c56f2c3bfb2c43d7d17836a7e51ec3"
# The versions Orecchino's CI builds with.
ESP32_CORE="esp32:esp32@3.3.11"
NIMBLE="NimBLE-Arduino@2.5.1"
FQBN="esp32:esp32:XIAO_ESP32S3:PSRAM=opi,PartitionScheme=default_8MB"

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
cache="$root/.cache/orecchino"
src="$cache/$ORECCHINO_REF"
cli="${ARDUINO_CLI:-arduino-cli}"

port=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) port="${2:?--port needs a device path}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ ! -f "$here/orecchino_http/wifi_secrets.h" ]; then
  echo "Missing $here/orecchino_http/wifi_secrets.h. Copy wifi_secrets.example.h and fill in your 2.4 GHz network." >&2
  exit 1
fi
command -v "$cli" >/dev/null || { echo "arduino-cli not found. Install it or set ARDUINO_CLI." >&2; exit 1; }

"$cli" core install "$ESP32_CORE" --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
"$cli" lib install --no-deps "$NIMBLE"

if [ "$(git -C "$src" rev-parse -q --verify HEAD 2>/dev/null)" != "$ORECCHINO_REF" ]; then
  rm -rf "$src"
  mkdir -p "$src"
  git -C "$src" init -q
  git -C "$src" fetch -q --depth 1 "$ORECCHINO_REPO" "$ORECCHINO_REF"
  git -C "$src" checkout -q FETCH_HEAD
fi
# Start from the pinned tree every time, so the patch always applies cleanly.
git -C "$src" checkout -q -- .
git -C "$src" apply "$here/rx-hook-decoded.patch"
rm -rf "$src/firmware/orecchino_http"
cp -R "$here/orecchino_http" "$src/firmware/orecchino_http"

"$cli" compile --libraries "$src/firmware/libraries" --fqbn "$FQBN" --build-path "$cache/build" "$src/firmware/orecchino_http"
if [ -n "$port" ]; then
  "$cli" upload --fqbn "$FQBN" --input-dir "$cache/build" --port "$port" "$src/firmware/orecchino_http"
fi
