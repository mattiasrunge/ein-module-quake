# quake2-demo — puts Quake II's demo in the games folder once, when the module is installed, then
# ends.
#
# The demo of Quake II 3.14 is id Software's, free to play and to pass on, by electronic means and
# free of charge, with its licence beside it. Its release, as id published it (a self-extracting
# zip), is fetched from a mirror of id's FTP site, checked against the SHA-256 below, and its
# pak0.pak put in a game folder of its own with the licence, license.txt. A marker beside the games
# says it was done, so a game deleted from the page stays deleted. Without the network it tries again
# every ten minutes.
release=3.14
url=https://ftp.gwdg.de/pub/misc/ftp.idsoftware.com/idstuff/quake2/q2-314-demo-x86.exe
sha256=7ace5a43983f10d6bdc9d9b6e17a1032ba6223118d389bd170df89b945a04a1e
games=/groups/users/quake
game=$games/quake2-demo
marker=$games/.quake2-demo-$release
# Unpacked outside the household's folders, where EiN's media pipelines would read the
# release's pictures.
work=/tmp/quake2-demo

if [ -e "$marker" ]; then
  echo "quake2-demo: $release is already in $games"
  exit 0
fi

mkdir -p "$games"
# Game data and music, none of it the household's: EiN's media pipelines leave the folder alone.
attrs -J 'processing=[]' "$games"
until curl -fLs -o "$work.zip" "$url"; do
  echo "quake2-demo: could not fetch $url; trying again in ten minutes"
  sleep 600
done
if ! attrs "$work.zip" | grep -q "$sha256"; then
  echo "quake2-demo: $url is not the release it should be (its SHA-256 is not $sha256)"
  rm "$work.zip"
  exit 1
fi
unzip -o -d "$work" "$work.zip" > /dev/null || exit 1
mkdir -p "$game"
# One someone uploaded under the same name is theirs to keep.
if [ ! -e "$game/pak0.pak" ]; then
  mv "$work/Install/Data/baseq2/pak0.pak" "$game/pak0.pak"
fi
mv "$work/Install/Data/DOCS/license.txt" "$game/license.txt"
rm -r "$work" "$work.zip"
echo "$url" > "$marker"
echo "quake2-demo: $release put in $game"
