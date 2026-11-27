#!/bin/sh
# Compiles Quake 3 to WebAssembly in ioquake3's patched source tree, the current directory, into
# /out: the game the page plays (quake3.js, quake3.wasm) and its dedicated server, which the
# quake-server service runs in a worker (quake3-server.js, quake3-server.wasm). Run by
# engine/quake3/Containerfile in the emsdk image; `client` or `server` builds one of them.
set -eu

# What the game and the server share: ioquake3's core, its server and the bots' library, with its
# Unix system layer and zlib for the pk3s, but the network the page carries (net_ein.c) in place of
# its sockets. Game code is the game's own QVMs, which the interpreter runs: WebAssembly has no
# compiler for them.
COMMON="qcommon/cm_load qcommon/cm_patch qcommon/cm_polylib qcommon/cm_test qcommon/cm_trace qcommon/cmd qcommon/common qcommon/cvar qcommon/files qcommon/md4 qcommon/md5 qcommon/msg qcommon/net_chan qcommon/huffman qcommon/q_math qcommon/q_shared qcommon/unzip qcommon/ioapi qcommon/vm qcommon/vm_interpreted
server/sv_bot server/sv_client server/sv_ccmds server/sv_game server/sv_init server/sv_main server/sv_net_chan server/sv_snapshot server/sv_world
botlib/be_aas_bspq3 botlib/be_aas_cluster botlib/be_aas_debug botlib/be_aas_entity botlib/be_aas_file botlib/be_aas_main botlib/be_aas_move botlib/be_aas_optimize botlib/be_aas_reach botlib/be_aas_route botlib/be_aas_routealt botlib/be_aas_sample botlib/be_ai_char botlib/be_ai_chat botlib/be_ai_gen botlib/be_ai_goal botlib/be_ai_move botlib/be_ai_weap botlib/be_ai_weight botlib/be_ea botlib/be_interface botlib/l_crc botlib/l_libvar botlib/l_log botlib/l_memory botlib/l_precomp botlib/l_script botlib/l_struct
sys/con_log sys/con_passive sys/sys_main sys/sys_unix asm/ftola asm/snapvector
ein/net_ein
thirdparty/zlib-1.3.1/adler32 thirdparty/zlib-1.3.1/crc32 thirdparty/zlib-1.3.1/inffast thirdparty/zlib-1.3.1/inflate thirdparty/zlib-1.3.1/inftrees thirdparty/zlib-1.3.1/zutil"
# The game's: its client, sound mixer with Ogg Vorbis music, and the OpenGL 2 renderer with its
# shaders, but SDL's input, sound and window, which the page's are in place of (quake3_ein.c,
# snd_ein.c, glimp_ein.c). No OpenAL, VoIP, Mumble or downloads over HTTP.
CLIENT="client/cl_cgame client/cl_cin client/cl_console client/cl_input client/cl_keys client/cl_main client/cl_net_chan client/cl_parse client/cl_scrn client/cl_ui client/cl_avi client/snd_adpcm client/snd_dma client/snd_mem client/snd_mix client/snd_wavelet client/snd_main client/snd_codec client/snd_codec_wav client/snd_codec_ogg client/snd_openal
renderercommon/tr_font renderercommon/tr_image_bmp renderercommon/tr_image_jpg renderercommon/tr_image_pcx renderercommon/tr_image_png renderercommon/tr_image_pvr renderercommon/tr_image_tga renderercommon/tr_noise renderercommon/puff
renderergl2/tr_animation renderergl2/tr_backend renderergl2/tr_bsp renderergl2/tr_cmds renderergl2/tr_curve renderergl2/tr_dsa renderergl2/tr_extramath renderergl2/tr_extensions renderergl2/tr_fbo renderergl2/tr_flares renderergl2/tr_glsl renderergl2/tr_image renderergl2/tr_image_dds renderergl2/tr_init renderergl2/tr_light renderergl2/tr_main renderergl2/tr_marks renderergl2/tr_mesh renderergl2/tr_model renderergl2/tr_model_iqm renderergl2/tr_postprocess renderergl2/tr_scene renderergl2/tr_shade renderergl2/tr_shade_calc renderergl2/tr_shader renderergl2/tr_shadows renderergl2/tr_sky renderergl2/tr_surface renderergl2/tr_vbo renderergl2/tr_world
ein/quake3_ein ein/snd_ein ein/glimp_ein"
# The dedicated server's: the client, its input and its sound stubbed out (null/), and its entry.
SERVER="null/null_client null/null_input null/null_snddma ein/server_ein"
# The libraries the client reads pictures and music with, from ioquake3's tree.
LIBRARIES="thirdparty/libogg-1.3.6/src/bitwise thirdparty/libogg-1.3.6/src/framing
thirdparty/libvorbis-1.3.7/lib/analysis thirdparty/libvorbis-1.3.7/lib/bitrate thirdparty/libvorbis-1.3.7/lib/block thirdparty/libvorbis-1.3.7/lib/codebook thirdparty/libvorbis-1.3.7/lib/envelope thirdparty/libvorbis-1.3.7/lib/floor0 thirdparty/libvorbis-1.3.7/lib/floor1 thirdparty/libvorbis-1.3.7/lib/info thirdparty/libvorbis-1.3.7/lib/lookup thirdparty/libvorbis-1.3.7/lib/lpc thirdparty/libvorbis-1.3.7/lib/lsp thirdparty/libvorbis-1.3.7/lib/mapping0 thirdparty/libvorbis-1.3.7/lib/mdct thirdparty/libvorbis-1.3.7/lib/psy thirdparty/libvorbis-1.3.7/lib/registry thirdparty/libvorbis-1.3.7/lib/res0 thirdparty/libvorbis-1.3.7/lib/sharedbook thirdparty/libvorbis-1.3.7/lib/smallft thirdparty/libvorbis-1.3.7/lib/synthesis thirdparty/libvorbis-1.3.7/lib/vorbisfile thirdparty/libvorbis-1.3.7/lib/window
thirdparty/jpeg-9f/jaricom thirdparty/jpeg-9f/jcapimin thirdparty/jpeg-9f/jcapistd thirdparty/jpeg-9f/jcarith thirdparty/jpeg-9f/jccoefct thirdparty/jpeg-9f/jccolor thirdparty/jpeg-9f/jcdctmgr thirdparty/jpeg-9f/jchuff thirdparty/jpeg-9f/jcinit thirdparty/jpeg-9f/jcmainct thirdparty/jpeg-9f/jcmarker thirdparty/jpeg-9f/jcmaster thirdparty/jpeg-9f/jcomapi thirdparty/jpeg-9f/jcparam thirdparty/jpeg-9f/jcprepct thirdparty/jpeg-9f/jcsample thirdparty/jpeg-9f/jctrans thirdparty/jpeg-9f/jdapimin thirdparty/jpeg-9f/jdapistd thirdparty/jpeg-9f/jdarith thirdparty/jpeg-9f/jdatadst thirdparty/jpeg-9f/jdatasrc thirdparty/jpeg-9f/jdcoefct thirdparty/jpeg-9f/jdcolor thirdparty/jpeg-9f/jddctmgr thirdparty/jpeg-9f/jdhuff thirdparty/jpeg-9f/jdinput thirdparty/jpeg-9f/jdmainct thirdparty/jpeg-9f/jdmarker thirdparty/jpeg-9f/jdmaster thirdparty/jpeg-9f/jdmerge thirdparty/jpeg-9f/jdpostct thirdparty/jpeg-9f/jdsample thirdparty/jpeg-9f/jdtrans thirdparty/jpeg-9f/jerror thirdparty/jpeg-9f/jfdctflt thirdparty/jpeg-9f/jfdctfst thirdparty/jpeg-9f/jfdctint thirdparty/jpeg-9f/jidctflt thirdparty/jpeg-9f/jidctfst thirdparty/jpeg-9f/jidctint thirdparty/jpeg-9f/jmemmgr thirdparty/jpeg-9f/jmemnobs thirdparty/jpeg-9f/jquant1 thirdparty/jpeg-9f/jquant2 thirdparty/jpeg-9f/jutils"
INCLUDES="-Ithirdparty/libogg-1.3.6/include -Ithirdparty/libvorbis-1.3.7/include -Ithirdparty/libvorbis-1.3.7/lib -Ithirdparty/zlib-1.3.1 -Ithirdparty/jpeg-9f -Ithirdparty/SDL2-2.32.8/include -I."
# ioquake3's own, as its CMake build sets them, with EIN for the patches and no SDL linked: its
# headers only give OpenGL's names (qgl.h).
DEFINES="-DEIN -DNDEBUG -DBOTLIB -DNO_GZIP -DUSE_CODEC_VORBIS -DUSE_INTERNAL_SDL_HEADERS -DPRODUCT_VERSION=\"1.36_ein\""

# Each shader of the renderer as a C string, as ioquake3's stringify_shader.cmake makes them.
shaders() {
  mkdir -p shaders
  for glsl in renderergl2/glsl/*.glsl; do
    name=$(basename "$glsl" .glsl)
    awk -v name="$name" 'BEGIN { print "const char *fallbackShader_" name " =" } { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); print "\"" $0 "\\n\"" } END { print ";" }' "$glsl" > "shaders/$name.c"
    echo "shaders/$name"
  done
}

# Compile the sources, each to its object for the build `$1` (client or server), two at a time,
# and list the objects. Each is compiled by this script again (`object`), so a failed one fails the
# build.
compile() {
  build=$1
  shift
  for name in "$@"; do echo "$name"; done | xargs -P "${EMCC_CORES:-2}" -n 1 sh "$0" object "$build" >&2
  for name in "$@"; do echo "obj/$build/$name.o"; done
}

# The glue is headed with Deno's ignore comments, so core's `deno fmt` and `deno lint` pass over the
# generated file. Quake 3's Com_Error leaves a frame with longjmp, which Emscripten's own setjmp
# handles.
link() {
  name=$1
  objects=$2
  shift 2
  emcc -O2 $objects -o "/out/$name.js" \
    -sMODULARIZE=1 -sEXPORT_ES6=1 \
    -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=5MB \
    -sSUPPORT_LONGJMP=emscripten \
    -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAP16,HEAPU32,stringToNewUTF8,UTF8ToString \
    -sFORCE_FILESYSTEM=1 "$@"
  { printf '%s\n' '// deno-fmt-ignore-file' '// deno-lint-ignore-file' '// Generated by engine/quake3/Containerfile with Emscripten. Do not edit.'; cat "/out/$name.js"; } > "/out/$name.js.new"
  mv "/out/$name.js.new" "/out/$name.js"
}

case "${1:-all}" in object)
  # One source, `$3`, for the build `$2`: the server's is the engine without its client (DEDICATED).
  object="obj/$2/$3.o"
  mkdir -p "$(dirname "$object")"
  exec emcc -O2 -std=gnu99 -w -fno-strict-aliasing $DEFINES $INCLUDES $([ "$2" = server ] && echo -DDEDICATED) -c "$3.c" -o "$object"
  ;;
esac

mkdir -p /out
# The game runs in a worker of the page's (ui/quake/quake3-worker.ts), which reads the game's pk3s a
# piece at a time as the engine asks, with synchronous range requests, which only a worker may make.
case "${1:-all}" in all | client)
  objects=$(compile client $COMMON $CLIENT $LIBRARIES $(shaders))
  link quake3 "$objects" \
    -sEXPORT_NAME=createQuake3 -sENVIRONMENT=worker -sINITIAL_MEMORY=256MB \
    -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sGL_ENABLE_GET_PROC_ADDRESS=1 \
    -sEXPORTED_FUNCTIONS=_ein_start,_ein_tick,_ein_key,_ein_char,_ein_mouse,_ein_disconnect,_ein_write_config,_ein_menu,_ein_fullscreen,_ein_set_fullscreen,_ein_frames,_ein_audio_rate,_ein_audio_render,_malloc
  ;;
esac
# The server runs in a Deno worker, which Emscripten's web runtime suits once it is handed the wasm.
case "${1:-all}" in all | server)
  objects=$(compile server $COMMON $SERVER)
  link quake3-server "$objects" \
    -sEXPORT_NAME=createQuake3Server -sENVIRONMENT=web -sINITIAL_MEMORY=128MB \
    -sEXPORTED_FUNCTIONS=_ein_start,_ein_tick,_ein_status,_malloc
  ;;
esac
