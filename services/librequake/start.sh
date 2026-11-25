# librequake — puts LibreQuake and its music in the games folder once, when the module is installed,
# then ends.
#
# LibreQuake (https://github.com/lavenderdotpet/LibreQuake) is free game data for Quake's engine, its
# art, sounds and music under a BSD licence and its game code under the GPL. Its lite release, the
# one made for the original engine, is fetched, checked against the SHA-256 below, its paks put in a
# game folder of its own and its music in the music folder beside the games, which every game
# without music of its own plays. A marker beside the games says it was done, so a game deleted from
# the page stays deleted. Without the network it tries again every ten minutes.
release=0.09-beta
url=https://github.com/lavenderdotpet/LibreQuake/releases/download/v$release/lite.zip
sha256=428e736b2f01d953e09a08c60bee975bdc4a0ac2219e97fa095c8af41754da83
games=/groups/users/quake
game=$games/librequake
music=$games/music
marker=$games/.librequake-$release
# Unpacked outside the household's folders, where EiN's media pipelines would read the
# release's pictures.
work=/tmp/quake-librequake

if [ -e "$marker" ]; then
  echo "librequake: $release is already in $games"
  exit 0
fi

mkdir -p "$games"
# Game data and music, none of it the household's: EiN's media pipelines leave the folder alone.
attrs -J 'processing=[]' "$games"
until curl -fLs -o "$work.zip" "$url"; do
  echo "librequake: could not fetch $url; trying again in ten minutes"
  sleep 600
done
if ! attrs "$work.zip" | grep -q "$sha256"; then
  echo "librequake: $url is not the release it should be (its SHA-256 is not $sha256)"
  rm "$work.zip"
  exit 1
fi
unzip -o -d "$work" "$work.zip" > /dev/null || exit 1
mkdir -p "$game" "$music"
# One someone uploaded under the same name is theirs to keep.
for pak in pak0.pak pak1.pak; do
  if [ ! -e "$game/$pak" ]; then
    mv "$work/lite/id1/$pak" "$game/$pak"
  fi
done
for track in 02 03 04 05 06 07 08 09 10 11; do
  if [ ! -e "$music/track$track.ogg" ]; then
    mv "$work/lite/id1/music/track$track.ogg" "$music/track$track.ogg"
  fi
done
rm -r "$work" "$work.zip"
echo "$url" > "$marker"
echo "librequake: $release put in $game, its music in $music"
