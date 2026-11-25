# shareware — puts Quake's shareware episode in the games folder once, when the module is installed,
# then ends.
#
# The shareware episode of Quake 1.06 is id Software's, free to play and to pass on unchanged. Its
# release, as the Internet Archive keeps it installed, is fetched, checked against the SHA-256
# below, and its pak0.pak put in a game folder of its own, which the page lists first. A marker
# beside the games says it was done, so a game deleted from the page stays deleted. Without the
# network it tries again every ten minutes.
release=1.06
url=https://archive.org/download/Quake_802/zQUAKE_SW-play.zip
sha256=f6db68de2a4b7dd8b250e2d8ab1c9a83ea321fabd2bb63c4c0dd5fed6f69e61a
games=/groups/users/quake
game=$games/shareware
marker=$games/.shareware-$release
# Unpacked outside the household's folders, where EiN's media pipelines would read the
# release's pictures.
work=/tmp/quake-shareware

if [ -e "$marker" ]; then
  echo "shareware: $release is already in $games"
  exit 0
fi

mkdir -p "$games"
# Game data and music, none of it the household's: EiN's media pipelines leave the folder alone.
attrs -J 'processing=[]' "$games"
until curl -fLs -o "$work.zip" "$url"; do
  echo "shareware: could not fetch $url; trying again in ten minutes"
  sleep 600
done
if ! attrs "$work.zip" | grep -q "$sha256"; then
  echo "shareware: $url is not the release it should be (its SHA-256 is not $sha256)"
  rm "$work.zip"
  exit 1
fi
unzip -o -d "$work" "$work.zip" > /dev/null || exit 1
mkdir -p "$game"
# One someone uploaded under the same name is theirs to keep.
if [ ! -e "$game/pak0.pak" ]; then
  mv "$work/ID1/PAK0.PAK" "$game/pak0.pak"
fi
rm -r "$work" "$work.zip"
echo "$url" > "$marker"
echo "shareware: $release put in $game"
