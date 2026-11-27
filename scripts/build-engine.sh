#!/bin/sh
# Builds Quake, Quake 2 and Quake 3 to WebAssembly in containers (engine/Containerfile,
# engine/quake2/Containerfile, engine/quake3/Containerfile) and writes assets/quake.js,
# assets/quake.wasm, assets/quake2.js, assets/quake2.wasm, assets/quake3.js, assets/quake3.wasm, their
# dedicated servers' and a -build.txt for each. Needs only docker with buildx, or podman; run from
# anywhere.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
build() {
  if command -v docker >/dev/null 2>&1; then
    docker buildx build --file "$1/Containerfile" --output "type=local,dest=$root/assets" "$1"
  else
    podman build --file "$1/Containerfile" --output "type=local,dest=$root/assets" "$1"
  fi
}
build "$root/engine"
build "$root/engine/quake2"
build "$root/engine/quake3"
ls -l "$root/assets/quake.js" "$root/assets/quake.wasm" "$root/assets/quake2.js" "$root/assets/quake2.wasm" "$root/assets/quake3.js" "$root/assets/quake3.wasm"
