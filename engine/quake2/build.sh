#!/bin/sh
# Compiles Yamagi Quake II to WebAssembly in its patched source tree, the current directory, with
# this module's platform layer in ein/, into /out: the game the page plays, in the module's worker
# (quake2.js, quake2.wasm), and its dedicated server, which the quake-server service runs in a worker
# (quake2-server.js, quake2-server.wasm). Run by engine/quake2/Containerfile in the emsdk image;
# `client` or `server` builds one of them.
set -eu

# Yamagi's own, as its Makefile sets them, with EIN for the patches and this platform layer.
FLAGS="-O2 -std=gnu99 -w -fno-strict-aliasing -fwrapv -DEIN -DNOUNCRYPT -DIOAPI_NO_64"

# The engine's sources, from Yamagi's Makefile: what the game and its server share, the server and
# id's file formats; then the client's, without SDL's input, sound device, window and main loop, cURL
# and OpenAL, but this build's in their place (ein/): the page's keys and mouse, its music and its
# frames. The sound is the game's own mixer (sound/sdl.c, patched), which the page plays.
COMMON="src/backends/generic/misc src/backends/unix/system src/common/argproc src/common/clientserver src/common/collision src/common/crc src/common/cmdparser src/common/cvar src/common/filesystem src/common/glob src/common/md4 src/common/frame src/common/movemsg src/common/netchan src/common/pmove src/common/szone src/common/zone src/common/shared/flash src/common/shared/rand src/common/shared/shared src/common/unzip/ioapi src/common/unzip/unzip src/common/unzip/miniz/miniz src/common/unzip/miniz/miniz_tdef src/common/unzip/miniz/miniz_tinfl
src/server/sv_cmd src/server/sv_conless src/server/sv_entities src/server/sv_game src/server/sv_init src/server/sv_main src/server/sv_save src/server/sv_send src/server/sv_user src/server/sv_world
ein/net_ein"
CLIENT="src/client/cl_cin src/client/cl_image src/client/cl_console src/client/cl_download src/client/cl_effects src/client/cl_entities src/client/cl_input src/client/cl_inventory src/client/cl_keyboard src/client/cl_lights src/client/cl_main src/client/cl_network src/client/cl_parse src/client/cl_particles src/client/cl_prediction src/client/cl_screen src/client/cl_tempentities src/client/cl_view
src/client/menu/menu src/client/menu/qmenu src/client/menu/videomenu src/client/sound/sdl src/client/sound/sound src/client/sound/wave src/client/vid/vid
ein/quake2_ein ein/glimp_ein ein/input_ein ein/ogg_ein"
# The dedicated server's entry.
SERVER="ein/server_ein"

# id's game code, Yamagi's baseq2, linked in rather than loaded as game.so: Sys_GetGameAPI
# (system.patch) calls its GetGameAPI, named game_GetGameAPI here.
GAME="src/common/shared/flash src/common/shared/rand src/common/shared/shared
src/game/g_ai src/game/g_chase src/game/g_cmds src/game/g_combat src/game/g_func src/game/g_items src/game/g_main src/game/g_misc src/game/g_monster src/game/g_phys src/game/g_spawn src/game/g_svcmds src/game/g_target src/game/g_trigger src/game/g_turret src/game/g_utils src/game/g_weapon
src/game/monster/berserker/berserker src/game/monster/boss2/boss2 src/game/monster/boss3/boss3 src/game/monster/boss3/boss31 src/game/monster/boss3/boss32 src/game/monster/brain/brain src/game/monster/chick/chick src/game/monster/flipper/flipper src/game/monster/float/float src/game/monster/flyer/flyer src/game/monster/gladiator/gladiator src/game/monster/gunner/gunner src/game/monster/hover/hover src/game/monster/infantry/infantry src/game/monster/insane/insane src/game/monster/medic/medic src/game/monster/misc/move src/game/monster/mutant/mutant src/game/monster/parasite/parasite src/game/monster/soldier/soldier src/game/monster/supertank/supertank src/game/monster/tank/tank
src/game/player/client src/game/player/hud src/game/player/trail src/game/player/view src/game/player/weapon src/game/savegame/savegame"

# The renderers, linked in rather than loaded as ref_*.so (renderers.patch): the OpenGL ES 3 one,
# drawing with WebGL 2 through its context here (ein/gl3_ein, in place of gl3_sdl), and the software
# one (soft.patch), each with its own copy of the files they share and model memory without mmap
# (ein/hunk_ein). Their GetRefAPI is named gles3_GetRefAPI and soft_GetRefAPI here.
FILES="src/client/refresh/files/common src/client/refresh/files/surf src/client/refresh/files/models src/client/refresh/files/pcx src/client/refresh/files/stb src/client/refresh/files/wal src/client/refresh/files/pvs src/common/shared/shared src/common/md4 ein/hunk_ein"
GLES3="src/client/refresh/gl3/gl3_draw src/client/refresh/gl3/gl3_image src/client/refresh/gl3/gl3_light src/client/refresh/gl3/gl3_lightmap src/client/refresh/gl3/gl3_main src/client/refresh/gl3/gl3_mesh src/client/refresh/gl3/gl3_misc src/client/refresh/gl3/gl3_model src/client/refresh/gl3/gl3_surf src/client/refresh/gl3/gl3_warp src/client/refresh/gl3/gl3_shaders src/client/refresh/gl3/glad-gles3/src/glad ein/gl3_ein $FILES"
SOFT="src/client/refresh/soft/sw_aclip src/client/refresh/soft/sw_alias src/client/refresh/soft/sw_bsp src/client/refresh/soft/sw_draw src/client/refresh/soft/sw_edge src/client/refresh/soft/sw_image src/client/refresh/soft/sw_light src/client/refresh/soft/sw_main src/client/refresh/soft/sw_misc src/client/refresh/soft/sw_model src/client/refresh/soft/sw_part src/client/refresh/soft/sw_poly src/client/refresh/soft/sw_polyset src/client/refresh/soft/sw_rast src/client/refresh/soft/sw_scan src/client/refresh/soft/sw_sprite src/client/refresh/soft/sw_surf $FILES"

# What each set of objects is compiled with beside FLAGS.
extra() {
  case "$1" in
    server) echo "-DDEDICATED_ONLY" ;;
    gles3*) echo "-DYQ2_GL3_GLES3 -DYQ2_GL3_GLES -Isrc/client/refresh/gl3/glad-gles3/include" ;;
    *) echo "" ;;
  esac
}

# Compile the sources, each to its object in obj/$1, two at a time, and list the objects. Each is
# compiled by this script again (`object`), so a failed one fails the build. With $2, each is
# compiled with that header first.
compile() {
  set=$1
  include=$2
  shift 2
  for name in "$@"; do echo "$name"; done | xargs -P "${EMCC_CORES:-2}" -n 1 sh "$0" object "$set" "$include" >&2 || exit 1
  for name in "$@"; do echo "obj/$set/$name.o"; done
}

# A set of objects linked in beside others that defines names of its own those define too (the
# renderers' and the game's copies of the shared code, their Com_Printf and their GetRefAPI or
# GetGameAPI): compiled once to find every name it defines, then again with each of them prefixed
# with `$1_`, so the sets never meet but through the functions the engine is handed.
namespaced() {
  prefix=$1
  shift
  plain=$(compile "$prefix-plain" "" "$@") || exit 1
  mkdir -p "obj/$prefix"
  emnm -g --defined-only -j $plain | sort -u | awk -v prefix="$prefix" 'NF { print "#define " $1 " " prefix "_" $1 }' > "obj/$prefix/names.h"
  compile "$prefix" "obj/$prefix/names.h" "$@"
}

# The glue is headed with Deno's ignore comments, so core's `deno fmt` and `deno lint` pass over the
# generated file. Quake 2's Com_Error leaves a frame with longjmp, which Emscripten's own setjmp
# handles.
link() {
  name=$1
  objects=$2
  shift 2
  emcc -O2 $objects -o "/out/$name.js" \
    -sMODULARIZE=1 -sEXPORT_ES6=1 \
    -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1MB \
    -sSUPPORT_LONGJMP=emscripten \
    -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAP16,HEAPU32,stringToNewUTF8,UTF8ToString \
    -sFORCE_FILESYSTEM=1 "$@"
  { printf '%s\n' '// deno-fmt-ignore-file' '// deno-lint-ignore-file' '// Generated by engine/quake2/Containerfile with Emscripten. Do not edit.'; cat "/out/$name.js"; } > "/out/$name.js.new"
  mv "/out/$name.js.new" "/out/$name.js"
}

case "${1:-all}" in object)
  # One source, `$4`, for the set `$2`, with the header `$3` first when there is one.
  object="obj/$2/$4.o"
  mkdir -p "$(dirname "$object")"
  exec emcc $FLAGS -DYQ2OSTYPE='"EiN"' -DYQ2ARCH='"wasm32"' -DBUILD_DATE='"May 14 2026"' $(extra "$2") ${3:+-include "$3"} -c "$4.c" -o "$object"
  ;;
esac

mkdir -p /out
game=$(namespaced game $GAME)
# The game runs in the module's worker (ui/quake/engine-worker.ts), which reads the game's paks a
# piece at a time as the engine asks, with synchronous range requests, which only a worker may make.
case "${1:-all}" in all | client)
  client=$(compile client "" $COMMON $CLIENT)
  gles3=$(namespaced gles3 $GLES3)
  soft=$(namespaced soft $SOFT)
  link quake2 "$client $game $gles3 $soft" \
    -sEXPORT_NAME=createQuake2 -sENVIRONMENT=worker -sINITIAL_MEMORY=128MB \
    -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sGL_ENABLE_GET_PROC_ADDRESS=1 \
    -sEXPORTED_FUNCTIONS=_ein_start,_ein_tick,_ein_key,_ein_char,_ein_mouse,_ein_disconnect,_ein_write_config,_ein_menu,_ein_fullscreen,_ein_set_fullscreen,_ein_frames,_ein_gl,_ein_screen,_ein_width,_ein_height,_ein_audio_rate,_ein_audio_render,_malloc
  ;;
esac
# The server runs in a Deno worker, which Emscripten's web runtime suits once it is handed the wasm.
case "${1:-all}" in all | server)
  server=$(compile server "" $COMMON $SERVER)
  link quake2-server "$server $game" \
    -sEXPORT_NAME=createQuake2Server -sENVIRONMENT=web -sINITIAL_MEMORY=64MB \
    -sEXPORTED_FUNCTIONS=_ein_start,_ein_tick,_ein_status,_malloc
  ;;
esac
