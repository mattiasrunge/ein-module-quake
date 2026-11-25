# quake

A module for [EiN](https://einhq.eu) that plays Quake and Quake II in the
browser, with sound and music, on a page of its own at `/quake`.

Each game has its engine, built to WebAssembly with Emscripten,
single-threaded, with a platform layer of its own and no SDL:

- Quake's is [quakegeneric](https://github.com/erysdren/quakegeneric), id
  Software's WinQuake made easy to port (`engine/quakegeneric_ein.c`). It draws
  with Quake's software renderer at 640 by 480, WinQuake's VGA mode.
- Quake II's is [quake2generic](https://github.com/ozkl/quake2generic), id
  Software's Quake II made easy to port, its game code linked in
  (`engine/quake2/quake2generic_ein.c`). It draws with Quake II's software
  renderer at 640 by 480, or the video mode the player chooses.

The page tells the games apart by what their paks hold, loads the game's engine
at runtime from the module's `assets/` directory, drives it from
`requestAnimationFrame` and draws its frames on a canvas.

It is not one of EiN's own modules and has nothing to do with a family's
archive.

## Install

As an administrator, open **Settings → Modules**, choose **Install**, and give
`https://github.com/mattiasrunge/ein-module-quake` under **From a repository**.

Quake appears in the sidebar under **Games**, a section between Browse and
System that the Doom module gives its page too. The module comes with no games.
Until they are there, the page's list offers three free ones, each with a
**Fetch** button for an administrator (EiN lets only the administrator fetch
from the internet) that downloads it from where its makers published it, checks
it against the release's SHA-256 and puts it in a folder of its own:

- **Quake (shareware)**: the first episode of id Software's Quake 1.06, which id
  let anyone play and pass on unchanged. The list has it first.
- **Quake II (demo)**: the demo of id Software's Quake II 3.14, the first three
  levels of its first unit, which id let anyone play and pass on free of charge
  with its licence. The licence is beside it, `license.txt` in its folder: it is
  for playing at home, not for showing in public.
- **LibreQuake**: [LibreQuake](https://github.com/lavenderdotpet/LibreQuake)'s
  free game data for Quake's engine, its lite release, the one made for the
  original engine. With it comes its music.

## Play

The page lists the games there are at the left, each with its title art, read
out of its paks, and under it its name and whether it is a Quake or a Quake II
game; on a phone they are behind the list button under the page's title. Choose
one to play it. The page remembers the one you played last, and its title art is
the picture in the page's header.

Click the game to give it the mouse and the keyboard: the browser hides the
pointer and the mouse turns and looks, as players have played since (`+mlook`
in Quake, free look in Quake II). The left button fires. WASD or the arrows
move, Space jumps, Shift runs, Alt strafes, Escape opens the game's menu, and
the key under Escape (`` ` ``) its console. Escape also gives the mouse back to
the browser; click the game to hand it over again. While the game has the mouse
or the focus it takes its keys before EiN does, Alt+letter included. The
buttons in the header turn the sound off and on and show the game full screen.
Quit in the game's menu goes back to the list.

A player who has played before starts with their own settings: the game's
**Options** and the keys bound in its controls menu are kept (below), and the
WASD keys and free look are only the first settings of a player who has none
yet. In Quake II, **Video** sets the frame's size; the page shows any of them at
4:3.

## Saved games and settings

The game's **Save** and **Load** keep your games in your home, in
`.quake/<game>/`, one folder for each game you play, so a save is loaded only
into the game it was made in and nobody else sees it. Beside them is
`config.cfg`, the game's settings and key bindings, written when you quit the
game, choose another, go to another page of EiN's or close the tab.

- Quake's slots are a file each, `s0.sav` to `s11.sav`, as Quake writes them.
- Quake II's are a folder each, `save/<slot>/`, as Quake II writes them: the
  game's `server.ssv` and `game.ssv`, and a `.sav` and a `.sv2` for each level
  of the unit you have been to. `save/save0` is the save Quake II makes itself
  when a new unit starts. A slot saved again replaces all of what was kept of
  it. A save holds the game code's own places in the engine, so one made with
  an earlier release of this module's Quake II may not load into a later one.

Without an account, saves and settings last only as long as the page.

## On a dashboard

With EiN's Dashboards module, add the **Quake** card to a dashboard and choose
its game. The card plays the game as it does when nobody plays: the demos
recorded in its paks, one after the other. It makes no sound and takes no keys.

## Add your own games

A game is a folder of paks, as Quake's `id1` and Quake II's `baseq2` are:
`pak0.pak`, and `pak1.pak` and on when it has them. Drag the folder from your
computer and drop it anywhere on the page, or choose **Upload** in the page's
header; it is uploaded, paks and all, and appears in the list under the
folder's name.

Which engine plays it, the paks say: a game whose paks have Quake II's pictures
(`pics/`), wall textures (`.wal`), models (`.md2`) or players' skins
(`players/`) is a Quake II game, and any other a Quake one.

- id's whole Quake: drop the `id1` folder of your Quake 1.06. The list calls a
  folder with id's `pak0.pak` and a `pak1.pak` **Quake**.
- To make the shareware episode the whole game, add the whole game's `pak1.pak`
  to the `shareware` folder: id's `pak0.pak` is the same in both.
- id's whole Quake II: drop the `baseq2` folder of your Quake II, 3.20 or
  later. The list calls a Quake II game with the map `base1` **Quake II**. Its
  single-player game is played; the mission packs, and mods with game code of
  their own (a `gamex86.dll`), are not yet.

## Add the music

Quake and Quake II played their music from the CD's audio tracks. To play the
CD's music, or any other, with a game, choose the game, then **Add music** under
⋮ in the page's header, and pick the tracks: Ogg, MP3, or whatever else the
browser plays. They are uploaded into a `music` folder in the game's own, and the
list says **music** under the game. A game without its own music plays none: the
shareware episode and Quake II's demo have none until you add it. The shareware
episode and the whole game share a folder, so its music is both's.

A track is known by the number its file's name starts with, after `track` or
not: `track02.ogg`, `02 - Quake.mp3`, `Track 2.mp3`. The games ask for the
CD's numbers, on which track 1 was the game's data and the music runs from 2 on;
a rip numbered from 1 skipped the data track, so when a folder has a track 1,
each of its tracks plays as the CD's one on. Rename a file whose name starts
otherwise, the artist's name say, in EiN's file browser.

Mods that need a game under them (`-game` in Quake, `game` in Quake II) are not
played yet.

The games are kept in `/groups/users/quake`, the household's shared folder, so
everyone with an account plays the same ones and may add to them, and they stay
when the module is updated or installed again. The folder's `processing`
attribute is empty, so EiN's media pipelines leave the music alone. The bin
beside a game deletes it for everyone; one of the free ones is offered again
once it is gone.

In EiN's terminal, `quake-games` lists the games with their titles, engines,
paks and music, and `quake-fetch shareware`, `quake-fetch quake2-demo` or
`quake-fetch librequake` fetches one of the free ones, as the page's **Fetch**
does.

## Sound

The sound effects are each game's own mixer, id's `snd_dma.c` and `snd_mix.c`,
painting a ring of samples ahead of where the page plays it, as it painted a
sound card's DMA buffer; Web Audio plays the ring. The games played their music
from the CD's audio tracks; here the page plays the game's file for the track
the game asks for. The browser plays the files itself (Ogg in Safari from 18.4).
In Quake, **Options → Sound Volume** and **CD Music Volume** set the effects and
the music; in Quake II, **Options → effects volume** sets the effects and **CD
music** turns the music on and off.

## Layout

| Path                                                                             | What it is for                                                                                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mod.json`, `ui/nav.json`                                                        | The manifest, and the sidebar entry with its Games section.                                                                                                     |
| `ui/pages/quake.tsx`                                                             | The page: the list of games, uploads, the game loop, keyboard, mouse, sound and fullscreen.                                                                     |
| `ui/cards/demo.tsx`                                                              | The dashboard card, offered in `etc/dashboard.d/cards.json`: a game running its demos.                                                                          |
| `ui/quake/games.ts`                                                              | Lists and deletes games.                                                                                                                                        |
| `ui/quake/conback.ts`                                                            | Draws a game's title art out of its console background, Quake's with its palette, Quake II's a PCX, fetching only those.                                        |
| `ui/quake/engine.ts`                                                             | Loads the game's engine, its glue and wasm, and the paks, and wraps the engine's exports; what differs between the engines.                                     |
| `ui/quake/saves.ts`                                                              | Reads and keeps the player's saves and settings in their home.                                                                                                  |
| `ui/quake/loop.ts`                                                               | Runs the game on animation frames and draws its frames, at the frame's size.                                                                                    |
| `ui/quake/sound.ts`                                                              | The effects and the music on Web Audio.                                                                                                                         |
| `ui/quake/keys.ts`                                                               | Browser key codes and mouse buttons to Quake's, which are Quake II's too.                                                                                       |
| `bin/quake-games`                                                                | Lists the games with their titles, engines, paks and music, for the page and the card's choice of game.                                                         |
| `lib/games.ts`, `lib/api.ts`                                                     | Where the games are, which engine plays a game, the games known by name, the free games the page offers, and the shape `quake-games` answers in.                |
| `lib/paks.ts`                                                                    | Reads a pak's header and directory, for `quake-games` and the title art.                                                                                        |
| `bin/quake-fetch`                                                                | Fetches one of the free games the page offers into the games folder, checked against its release's SHA-256.                                                     |
| `engine/quakegeneric_ein.c`                                                      | quakegeneric's platform layer for the page: the frame, keys, mouse and start-up.                                                                                |
| `engine/sys_ein.c`                                                               | The system driver: files, the clock, and Quit and errors that end the game.                                                                                     |
| `engine/snd_ein.c`                                                               | The sound card: the ring Quake's mixer paints, handed to the page.                                                                                              |
| `engine/cd_ein.c`                                                                | The CD player: tracks and their volume, handed to the page.                                                                                                     |
| `engine/Containerfile`                                                           | Quake's build: pinned emsdk image, quakegeneric commit and id's Quake source, for the sound.                                                                    |
| `engine/resolution.patch`                                                        | Makes the frame's size the build's, not quakegeneric's fixed 320 by 240.                                                                                        |
| `engine/files.patch`                                                             | Tells the page when Quake has saved a game or written its settings, so it can keep them.                                                                        |
| `engine/long-strings.patch`                                                      | Saves strings longer than 256 bytes, as LibreQuake's are, instead of overrunning the buffer they were written into.                                             |
| `engine/quake2/quake2generic_ein.c`                                              | quake2generic's platform layer for the page: the frame at the video mode's size, keys, mouse and start-up.                                                      |
| `engine/quake2/snd_ein.c`, `engine/quake2/cd_ein.c`                              | Quake II's sound card and CD player, as Quake's.                                                                                                                |
| `engine/quake2/Containerfile`                                                    | Quake II's build: pinned emsdk image and quake2generic commit.                                                                                                  |
| `engine/quake2/signatures.patch`                                                 | Gives two of the game code's functions the parameters they are called with, which WebAssembly holds them to.                                                    |
| `engine/quake2/volume.patch`                                                     | The mixer's volume of an 8-bit sound, which quake2generic had made silent.                                                                                      |
| `engine/quake2/files.patch`                                                      | Lists a folder's files, which saving a game needs, and tells the page when Quake II has saved a game or written its settings.                                   |
| `assets/icon.svg`                                                                | The Q of Quake, drawn for the module: the sidebar's and the dashboard card's icon, filled with the text colour.                                                 |
| `assets/quake.js`, `assets/quake.wasm`, `assets/quake2.js`, `assets/quake2.wasm` | The built engines, committed, since a module is installed as its repository stands. `assets/quake-build.txt` and `assets/quake2-build.txt` say what built them. |
| `scripts/build-engine.sh`                                                        | Rebuilds both engines into `assets/`.                                                                                                                           |
| `test/smoke.mjs`                                                                 | Signs in with headless Chrome, plays a little, saves screenshots.                                                                                               |
| `deno.jsonc`                                                                     | Generated from `mod.json` by core's `deno task sync:modules`, for type-checking in a core checkout.                                                             |

## Building the engine

Needs only docker with buildx, or podman; nothing is installed on the host.

    scripts/build-engine.sh

It builds `engine/Containerfile` and `engine/quake2/Containerfile` and exports
the results into `assets/` with the local exporter. The source of the committed
`assets/quake.wasm` is quakegeneric at the commit `engine/Containerfile` pins,
with `engine/resolution.patch`, `engine/files.patch` and
`engine/long-strings.patch` applied, id Software's `snd_dma.c`, `snd_mem.c` and
`snd_mix.c` from WinQuake at the commit it pins, and the `engine/` files added.
The source of `assets/quake2.wasm` is quake2generic at the commit
`engine/quake2/Containerfile` pins, with `engine/quake2/signatures.patch`,
`engine/quake2/volume.patch` and `engine/quake2/files.patch` applied and the
`engine/quake2/` files added.

## Developing

Mount the checkout read-only in EiN's container as `/modules-dev/quake` and set
`DEV_MODULES_PATH=/modules-dev`; EiN sets the module up when it starts, and it
runs instead of an installed one. The folder must be called `quake`, the
module's name. After a change to a page, run `ui-build quake` in EiN's terminal
and reload the browser; after a change to `mod.json`,
`mod setup quake`. A file in `assets/` is read as it is.

The smoke test wants a running EiN with the module and a game, Google Chrome,
and Node 22 or later:

    EIN_PASSWORD=... CHROME=/usr/bin/google-chrome node test/smoke.mjs --out /some/directory

## Licence

GPL-2.0-or-later, as quakegeneric, quake2generic and id's source are: see
`LICENSE`. Quake's and Quake II's source is © id Software and the quakegeneric
and quake2generic authors; their notices are in the source the builds fetch.
`assets/quake.js` and `assets/quake2.js` are Emscripten's runtime, under the MIT
licence. `assets/icon.svg` is the module's own drawing of Quake's Q, which is id
Software's trademark. The module fetches, when asked, and does not ship the games: Quake's
shareware episode is id Software's, under its own shareware licence; Quake II's
demo is id Software's, under its own demo licence, which is fetched with it; and
LibreQuake is under the BSD licence, its game code under the GPL.
