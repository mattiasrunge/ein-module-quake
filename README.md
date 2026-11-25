# quake

A module for [EiN](https://einhq.eu) that plays Quake in the browser, with sound
and music, on a page of its own at `/quake`.

The engine is [quakegeneric](https://github.com/erysdren/quakegeneric), id
Software's WinQuake made easy to port, built to WebAssembly with Emscripten,
single-threaded, with a platform layer of its own (`engine/quakegeneric_ein.c`)
and no SDL. It draws with Quake's software renderer at 640 by 480, WinQuake's
VGA mode. The page loads it at runtime from the module's `assets/` directory,
drives it from `requestAnimationFrame` and draws its frames on a canvas.

It is not one of EiN's own modules and has nothing to do with a family's
archive.

## Install

As an administrator, open **Settings → Modules**, choose **Install**, and give
`https://github.com/mattiasrunge/ein-module-quake` under **From a repository**.

Quake appears in the sidebar. While the module installs, it fetches two games,
so there is something to play straight away:

- **Quake (shareware)**: the first episode of id Software's Quake 1.06, which id
  let anyone play and pass on unchanged. The list has it first.
- **LibreQuake**: [LibreQuake](https://github.com/lavenderdotpet/LibreQuake)'s
  free game data for Quake's engine, its lite release, the one made for the
  original engine. With it comes its music.

## Play

The page lists the games there are at the left, each with its title art, read
out of its paks, and its name under it; on a phone they are behind the list
button under the page's title. Choose one to play it. The page remembers the one
you played last, and its title art is the picture in the page's header.

Click the game to give it the mouse and the keyboard: the browser hides the
pointer and the mouse turns and looks, as players have played since (`+mlook`).
The left button fires. WASD or the arrows move, Space jumps, Shift runs, Alt
strafes, Escape opens Quake's menu, and the key under Escape (`` ` ``) its
console. Escape also gives the mouse back to the browser; click the game to
hand it over again. While the game has the mouse or the focus it takes
its keys before EiN does, Alt+letter included. The buttons in the header turn
the sound off and on and show the game full screen. Quit in Quake's menu goes
back to the list.

A player who has played before starts with their own settings: Quake's
**Options** and the keys bound in **Customize controls** are kept (below), and
the WASD keys are only the first bindings of a player who has none yet.

## Saved games and settings

Quake's **Save** and **Load** keep your games in your home, in `.quake/<game>/`,
one folder for each game you play, so a save is loaded only into the game it was
made in and nobody else sees it. Each slot is a file, `s0.sav` to `s11.sav`, as
Quake writes it. Beside them is `config.cfg`, Quake's settings and key bindings,
written when you quit the game, choose another or go to another page of EiN's.

Without an account, saves and settings last only as long as the page.

## On a dashboard

With EiN's Dashboards module, add the **Quake** card to a dashboard and choose
its game. The card plays the game as Quake does when nobody plays: the demos
recorded in its paks, one after the other. It makes no sound and takes no keys.

## Add your own games

A game is a folder of paks, as Quake's `id1` is: `pak0.pak`, and `pak1.pak` and
on when it has them. Drag the folder from your computer and drop it anywhere on
the page, or choose **Upload** in the page's header; it is uploaded, paks and
all, and appears in the list under the folder's name.

- id's whole game: drop the `id1` folder of your Quake 1.06. The list calls a
  folder with id's `pak0.pak` and a `pak1.pak` **Quake**.
- To make the shareware episode the whole game, add the whole game's `pak1.pak`
  to the `shareware` folder: id's `pak0.pak` is the same in both.
- A game with music of its own has it in a `music` folder inside its own, as
  `track02.ogg` on, the numbers of the CD's tracks. A game without it plays the
  music in the `music` folder beside the games, which is LibreQuake's.

Mods that need a game under them (`-game` in Quake) are not played yet.

The games are kept in `/groups/users/quake`, the household's shared folder, so
everyone with an account plays the same ones and may add to them, and they stay
when the module is updated or installed again. The folder's `processing`
attribute is empty, so EiN's media pipelines leave the music alone. The bin
beside a game deletes it for everyone. A deleted game the module fetched stays
deleted; to fetch it again, delete `.shareware-1.06` or `.librequake-0.09-beta`
in that folder and restart the `shareware` or `librequake` service on the
**Status**'s services tab.

In EiN's terminal, `quake-games` lists the games with their titles, paks and
music.

## Sound

The sound effects are Quake's own mixer, id's `snd_dma.c` and `snd_mix.c`,
painting a ring of samples ahead of where the page plays it, as it painted a
sound card's DMA buffer; Web Audio plays the ring. Quake played its music from
the CD's audio tracks; here the page plays the game's `track<NN>.ogg` when Quake
asks for a track. The browser plays the Ogg files itself (Safari from 18.4).
**Options → Sound Volume** and **CD Music Volume** set the effects and the
music.

## Layout

| Path                                   | What it is for                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `mod.json`, `ui/nav.json`              | The manifest and the sidebar entry.                                                                                               |
| `ui/pages/quake.tsx`                   | The page: the list of games, uploads, the game loop, keyboard, mouse, sound and fullscreen.                                       |
| `ui/cards/demo.tsx`                    | The dashboard card, offered in `etc/dashboard.d/cards.json`: a game running its demos.                                            |
| `ui/quake/games.ts`                    | Lists and deletes games.                                                                                                          |
| `ui/quake/conback.ts`                  | Draws a game's title art out of its console background and palette, fetching only those.                                          |
| `ui/quake/engine.ts`                   | Loads the glue, the wasm and the paks, and wraps the engine's exports.                                                            |
| `ui/quake/saves.ts`                    | Reads and keeps the player's saves and settings in their home.                                                                    |
| `ui/quake/loop.ts`                     | Runs the game on animation frames and draws its frames.                                                                           |
| `ui/quake/sound.ts`                    | The effects and the music on Web Audio.                                                                                           |
| `ui/quake/keys.ts`                     | Browser key codes and mouse buttons to Quake's.                                                                                   |
| `bin/quake-games`                      | Lists the games with their titles, paks and music, for the page and the card's choice of game.                                    |
| `lib/games.ts`, `lib/api.ts`           | Where the games are, the games known by name, and the shape `quake-games` answers in.                                             |
| `services/shareware/`                  | Fetches the shareware episode into the games folder once, checked against its release's SHA-256, then ends.                       |
| `services/librequake/`                 | Fetches LibreQuake and its music the same way.                                                                                    |
| `engine/quakegeneric_ein.c`            | quakegeneric's platform layer for the page: the frame, keys, mouse and start-up.                                                  |
| `engine/sys_ein.c`                     | The system driver: files, the clock, and Quit and errors that end the game.                                                       |
| `engine/snd_ein.c`                     | The sound card: the ring Quake's mixer paints, handed to the page.                                                                |
| `engine/cd_ein.c`                      | The CD player: tracks and their volume, handed to the page.                                                                       |
| `engine/Containerfile`                 | The build: pinned emsdk image, quakegeneric commit and id's Quake source, for the sound.                                          |
| `engine/resolution.patch`              | Makes the frame's size the build's, not quakegeneric's fixed 320 by 240.                                                          |
| `engine/files.patch`                   | Tells the page when Quake has saved a game or written its settings, so it can keep them.                                          |
| `engine/long-strings.patch`            | Saves strings longer than 256 bytes, as LibreQuake's are, instead of overrunning the buffer they were written into.               |
| `assets/quake.js`, `assets/quake.wasm` | The built engine, committed, since a module is installed as its repository stands. `assets/quake-build.txt` says what built them. |
| `scripts/build-engine.sh`              | Rebuilds `assets/quake.js` and `assets/quake.wasm`.                                                                               |
| `test/smoke.mjs`                       | Signs in with headless Chrome, plays a little, saves screenshots.                                                                 |
| `deno.jsonc`                           | Generated from `mod.json` by core's `deno task sync:modules`, for type-checking in a core checkout.                               |

## Building the engine

Needs only docker with buildx, or podman; nothing is installed on the host.

    scripts/build-engine.sh

It builds `engine/Containerfile` and exports the result into `assets/` with the
local exporter. The source of the committed `assets/quake.wasm` is quakegeneric
at the commit `engine/Containerfile` pins, with `engine/resolution.patch`,
`engine/files.patch` and `engine/long-strings.patch` applied, id Software's
`snd_dma.c`, `snd_mem.c` and `snd_mix.c` from WinQuake at the commit it pins,
and the `engine/` files added.

## Developing

Mount the checkout read-only in EiN's container as `/modules-dev/quake` and set
`DEV_MODULES_PATH=/modules-dev`; EiN sets the module up when it starts, and it
runs instead of an installed one. The folder must be called `quake`, the
module's name. After a change to a page, run `ui-build quake` in EiN's terminal
and reload the browser; after a change to `mod.json` or a service,
`mod setup quake`. A file in `assets/` is read as it is.

The smoke test wants a running EiN with the module and a game, Google Chrome,
and Node 22 or later:

    EIN_PASSWORD=... CHROME=/usr/bin/google-chrome node test/smoke.mjs --out /some/directory

## Licence

GPL-2.0-or-later, as quakegeneric and Quake's source are: see `LICENSE`. Quake's
source is © id Software and the quakegeneric authors; their notices are in the
source the build fetches. `assets/quake.js` is Emscripten's runtime, under the
MIT licence. The module fetches and does not ship the games: the shareware
episode is id Software's, under its own shareware licence, and LibreQuake is
under the BSD licence, its game code under the GPL.
