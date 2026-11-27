#!/bin/sh
# Builds the game code the module plays Quake 3's games with, as QVMs, with ioquake3's compiler
# (q3lcc and q3asm, which its CMake build of the QVMs in /qvm built), and packs them as pk3s in /out,
# their files dated alike so a build makes the same bytes:
#
# - quake3-ui.pk3: ioquake3's q3_ui, the menus of id's Quake III Arena, its demo's and its whole
#   game's, with graphics.patch.
# - quake3-game.pk3: ioquake3's cgame and qagame, which the demo is played with: its own are older
#   than ioquake3 runs.
# - openarena-ui.pk3: OpenArena 0.8.8's q3_ui, from its source in /oa, with openarena-graphics.patch.
#   Built as OpenArena's Makefile builds it, it is byte for byte the ui.qvm of OpenArena's
#   pak6-patch088.pk3 without the patch.
set -eu

tools=${TOOLS:-/qvm/tools/Release}
vms=${VMS:-/qvm/Release/baseq3/vm}
oa=${OA:-/oa}
out=${OUT:-/out}

pack() {
  name=$1
  shift
  python3 -c "
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1], 'w')
for path in sys.argv[2:]:
    name = 'vm/' + path.rsplit('/', 1)[1]
    z.writestr(zipfile.ZipInfo(name, (1999, 12, 2, 0, 0, 0)), open(path, 'rb').read(), zipfile.ZIP_DEFLATED)
z.close()" "$out/$name" "$@"
}

pack quake3-ui.pk3 "$vms/ui.qvm"
pack quake3-game.pk3 "$vms/cgame.qvm" "$vms/qagame.qvm"

# OpenArena's ui: its files in the order of its Makefile's Q3UIOBJ_, the game's bg_misc and bg_lib
# compiled as its qagame's (-DQAGAME), then its syscalls.
asm=$(mktemp -d)
lcc() {
  define=$1
  source=$2
  (cd "$asm" && "$tools/q3lcc" $define -o "$asm/$(basename "$source" .c).asm" "$oa/code/$source" >&2)
  echo "$asm/$(basename "$source" .c).asm"
}
files="$(lcc -DUI q3_ui/ui_main.c) $(lcc -DQAGAME game/bg_misc.c) $(lcc -DQAGAME game/bg_lib.c)"
for name in addbots atoms cdkey challenges cinematics confirm connect controls2 credits demo2 display firstconnect gameinfo ingame \
  loadconfig menu mfield mods network options password playermodel players playersettings preferences qmenu removebots saveconfig \
  serverinfo servers2 setup sound sparena specifyserver splevel sppostgame spskill startserver team teamorders video votemenu \
  votemenu_fraglimit votemenu_timelimit votemenu_gametype votemenu_kick votemenu_map votemenu_custom; do
  files="$files $(lcc -DUI "q3_ui/ui_$name.c")"
done
files="$files $(lcc '' qcommon/q_math.c) $(lcc '' qcommon/q_shared.c)"
"$tools/q3asm" -o "$asm/ui.qvm" $files "$oa/code/ui/ui_syscalls.asm" >&2
pack openarena-ui.pk3 "$asm/ui.qvm"
