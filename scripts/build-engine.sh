#!/bin/sh
# Builds Quake to WebAssembly in a container (engine/Containerfile) and writes assets/quake.js,
# assets/quake.wasm and assets/quake-build.txt. Needs only docker with buildx, or podman; run from
# anywhere.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
if command -v docker >/dev/null 2>&1; then
  docker buildx build --file "$root/engine/Containerfile" --output "type=local,dest=$root/assets" "$root/engine"
else
  podman build --file "$root/engine/Containerfile" --output "type=local,dest=$root/assets" "$root/engine"
fi
ls -l "$root/assets/quake.js" "$root/assets/quake.wasm"
