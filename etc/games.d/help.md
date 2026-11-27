A game is a folder of paks: drag it from your computer and drop it anywhere on
the Games page. It becomes a card under the folder's name. Which engine plays
it, its paks say.

- **Quake**: the `id1` folder of Quake 1.06, with `pak0.pak` and `pak1.pak`.
  Dropping the whole game's `pak1.pak` on the shareware episode makes it the
  whole game.
- **Quake II**: the `baseq2` folder of Quake II 3.20 or later, with `pak0.pak`
  and on. The mission packs, and mods with game code of their own
  (`gamex86.dll`), are not played yet.
- **Quake III Arena**: the `baseq3` folder, with `pak0.pk3` and the 1.32 point
  release's `pak1.pk3` to `pak8.pk3`. Its CD key can come along as a `q3key`
  file or a `key.txt` with the key on a line; without one each player is asked
  for it once. Team Arena is not played yet.
- **A game of its own for Quake III's engine**, such as OpenArena: the folder of
  its pk3s, without a `pak0.pak`.

#### Music

Quake III's music is in its pk3s and needs nothing more. Quake and Quake II
played theirs from the CD's audio tracks: put the tracks in a folder called
`music` and drop it on the page, choosing the game, or put it in the game's
folder before you drop that.

- Ogg, MP3, Opus, FLAC, M4A, AAC or WAV.
- A track is known by the number its name starts with, after `track` or not:
  `track02.ogg`, `02 - Quake.mp3`, `Track 2.mp3`. Rename one that starts with
  anything else.
- The CD's music starts at track 2, since track 1 was the game's data. A rip
  numbered from 1 is moved up by one: when the folder has a track 1, it plays as
  the CD's 2.
- The shareware episode and Quake II's demo have no music until you add it.

#### Maps and more

Drop these on the page and choose the game when more than one could take them:

- a map, a `.bsp`: it goes into the `maps` folder of a game of its engine. The
  shareware episode plays only its own maps.
- a pk3, a Quake III map or mod with its textures: into a Quake III game.
- another pak, `pak1.pak` and on: into the game's folder.

Mods that need a game under them (`-game` in Quake, `game` in Quake II) are not
played yet.
