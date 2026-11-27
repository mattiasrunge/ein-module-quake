# quake

A module for [EiN](https://einhq.eu) that plays Quake and Quake II in the
browser, with sound and music, alone or together: a game someone hosts runs on
EiN, and others here, or on another EiN they are invited from, join it. Its games
are on EiN's **Games** page, which the games module gives: the module brings the
engines and its games, and the games module the page each is played on, the
saves, the sound, the dropped files and the playing together.

Each game has its engine, built to WebAssembly with Emscripten,
single-threaded, with a platform layer of its own and no SDL:

- Quake's is [quakegeneric](https://github.com/erysdren/quakegeneric), id
  Software's WinQuake made easy to port (`engine/quakegeneric_ein.c`). It draws
  with Quake's software renderer at 640 by 480, WinQuake's VGA mode.
- Quake II's is [quake2generic](https://github.com/ozkl/quake2generic), id
  Software's Quake II made easy to port, its game code linked in
  (`engine/quake2/quake2generic_ein.c`). It draws with Quake II's software
  renderer at 640 by 480, or the video mode the player chooses.

The module tells the games apart by what their paks hold. Its adapter
(`ui/adapter.ts`) loads the game's engine at runtime from the module's
`assets/` directory and hands it to the games module's page, which drives it
from `requestAnimationFrame` and draws its frames on a canvas.

It is not one of EiN's own modules and has nothing to do with a family's
archive.

## Install

It needs EiN's games module (`games`, 0.1 or later). As an administrator, open
**Settings → Modules**, choose **Install**, and give
`https://github.com/mattiasrunge/ein-module-quake` under **From a repository**.

The games are on the **Games** page, under Browse in the sidebar, a card each.
The module comes with no games. Until they are there, the Games page offers
three free ones under **Free to fetch**, each with a **Fetch** button for an
administrator (EiN lets only the administrator fetch from the internet) that
downloads it from where its makers published it, checks it against the
release's SHA-256 and puts it in a folder of its own:

- **Quake (shareware)**: the first episode of id Software's Quake 1.06, which id
  let anyone play and pass on unchanged. The list has it first.
- **Quake II (demo)**: the demo of id Software's Quake II 3.14, the first three
  levels of its first unit, which id let anyone play and pass on free of charge
  with its licence. The licence is beside it, `license.txt` in its folder: it is
  for playing at home, not for showing in public. Its players' models and skins
  are beside its pak, in `players/`, which the game loads as if they were in it;
  without them other players are not drawn. A demo fetched before this module
  brought them gets them with `quake-fetch quake2-demo` again.
- **LibreQuake**: [LibreQuake](https://github.com/lavenderdotpet/LibreQuake)'s
  free game data for Quake's engine, its lite release, the one made for the
  original engine. With it comes its music.

## Play

Each game's card on the Games page has its title art, read out of its paks, and
under its title whether it is a Quake or a Quake II game, its size and whether
it has music. Choose one to open its page, `/games/quake/<game>`, and **Play**
to play it. **Play on a map**, in the page's header, starts the game on the map
you choose instead, without its demos and menus.

Click the game to give it the mouse and the keyboard: the browser hides the
pointer and the mouse turns and looks, as players have played since (`+mlook`
in Quake, free look in Quake II). The left button fires. WASD or the arrows
move, Space jumps, Shift runs, Alt strafes, Escape opens the game's menu, and
the key under Escape (`` ` ``) its console. Escape also gives the mouse back to
the browser; click the game to hand it over again. While the game has the mouse
or the focus it takes its keys before EiN does, Alt+letter included. The
buttons in the header turn the sound off and on and show the game full screen.
Quit in the game's menu leaves the page as it was before **Play**.

A player who has played before starts with their own settings: the game's
**Options** and the keys bound in its controls menu are kept (below), and the
WASD keys, free look, always run and the crosshair are only the first settings
of a player who has none yet. Until you choose a name in the game's
**Multiplayer** menu, you play under your account's.

The game's frame is 640 by 480 until you choose another size, which the game
keeps. In Quake, **Options** > **Video Options** lists the modes, from 320 by 240
up to 1920 by 1200, 4:3 and widescreen (16:9 and 16:10); **Enter** sets the one
under the cursor. A wider frame sees more at its sides, not less above and below.
The console's `vid_width` and `vid_height` set any size up to 1920 by 1200. In
Quake II, **Video** sets the frame's size, from the same modes, once you choose
**apply**. The page shows the frame at its shape. A larger frame takes more of
the computer to draw.

The menus, the status bar and the console keep about the size they have at 640
by 480 on any frame: each of their pixels is a block of the frame's, 2 by 2 at
720 to 1080 lines, 3 by 3 at 1200, so they stay sharp. The console's `vid_scale`
sets the block's size instead (`vid_scale 3` makes them larger at 1080 lines);
`vid_scale 0` goes back to the frame's.

## Play together

Playing together is in the game's page's header, beside the sound and full
screen. **Start server** starts a server of the game that everyone here can play
on: choose the map, deathmatch (everyone against everyone) or cooperative
(together against the monsters), and how many may play, from 2 to 16. While it
runs, **Play** enters the game on it, for everyone here who has the game, and
says whose server it is and who plays; the one who started it, or an
administrator, has **Stop server**, which drops everyone in it. A server nobody
has played on for five minutes stops by itself.

The game's own **Multiplayer** menu sets who you are in a game: your name, and
your colours in Quake or your model and skin in Quake II. Joining and starting a
game are the page's, so that menu no longer offers them.

The game's server runs on EiN, not in anyone's browser: the module's
`quake-server` service runs each hosted game as Quake's or Quake II's dedicated
server, built for it beside the game (`assets/quake-server.wasm`,
`assets/quake2-server.wasm`), in a worker of EiN's own, so a slow frame never
holds up EiN. The games module's `GameServers` does the rest: it listens on each
game's socket node, seats each connection under its account's name (`guest` for
an invitation's) at a fake address (10.66.0.2 and on), which a page reloaded
gets again, and carries the game's datagrams both ways. The server is 10.66.0.1
to each player; the game connects to it as to any other server. The server is
given the game's maps beside its paks too, so a map dropped on the Games page
can be hosted. A page in a hidden tab stops the game, as it always has: the
player stands still in the game, and the server drops them after a while
(Quake II's after two minutes, Quake's after five).

An administrator starts the service with `service start quake-server`; it runs
until it is stopped. The hosted games are in
`/groups/users/games/servers/quake`, a folder each with its `server.json` and its
`socket`; the service empties it when it starts, since no game outlives it.

### Someone from another EiN

While a server runs, **Invite** gives a link to send to someone on another EiN.
On the game's page there they choose **Connect** and paste it, and **Play** then
enters the game on your server; **Disconnect** leaves it. They play with their
own EiN's copy of the game, so it has to be there (the same game, or one of the
same engine with the map). **Connect** is there while no server of the game runs
on their own EiN, and **Start server** while they are not connected to another.
The link is one of EiN's invitations: it connects to the game's socket, without
an account here, for twelve hours, and `invitation list` and `invitation remove`
show and end it.

### In the terminal

The games module's commands host, list, join, invite to and stop the games, of
this module as of any other; a game is the module's name and the game's folder:

| Command                                                   | What it does                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `games-host quake <game> [map] [--max N] [--mode M]`      | Hosts a game (`--mode deathmatch` or `coop`) and prints its id once its server runs |
| `games-servers [--module quake]`                          | Lists the hosted games, with who plays in each                                      |
| `games-join <id>`, `games-invite <id>`, `games-stop <id>` | The way into a game, a guest's invitation to it, and stopping it                    |

The game's own console works as well: `status`, `say`, `kill`.

## Saved games and settings

The game's **Save** and **Load** keep your games in your home, in
`.quake/<game>/`, one folder for each game you play, so a save is loaded only
into the game it was made in and nobody else sees it. Beside them is
`config.cfg`, the game's settings and key bindings, written when you quit the
game, go to another page of EiN's or close the tab.

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
its game, one of those installed. The card plays the game as it does when nobody plays: the demos
recorded in its paks, one after the other. It makes no sound and takes no keys.

## Add your own games

A game is a folder of paks, as Quake's `id1` and Quake II's `baseq2` are:
`pak0.pak`, and `pak1.pak` and on when it has them. Drag the folder from your
computer and drop it anywhere on the Games page; it is uploaded, paks and all,
and appears as a card under the folder's name.

The Games page knows what else of a game's is dropped on it, and asks which game
it goes into when more than one could take it:

- a Quake map (a `.bsp` of Quake's) into a Quake game's `maps/` folder, and a
  Quake II map into a Quake II game's. **Play on a map** and **Start server**
  then offer it. Quake's shareware episode plays only the maps in its paks, so
  give a map to the whole game or to LibreQuake.
- another pak, `pak1.pak` and on, into a game's folder.
- a folder called `music` into a game's folder (below).

Which engine plays it, the paks say: a game whose paks have Quake II's pictures
(`pics/`), wall textures (`.wal`), models (`.md2`) or players' skins
(`players/`) is a Quake II game, and any other a Quake one.

- id's whole Quake: drop the `id1` folder of your Quake 1.06. The list calls a
  folder with id's `pak0.pak` and a `pak1.pak` **Quake**.
- To make the shareware episode the whole game, drop the whole game's `pak1.pak`
  on the Games page and choose the shareware episode: id's `pak0.pak` is the same
  in both.
- id's whole Quake II: drop the `baseq2` folder of your Quake II, 3.20 or
  later. The list calls a Quake II game with the map `base1` **Quake II**. Its
  single-player game is played; the mission packs, and mods with game code of
  their own (a `gamex86.dll`), are not yet.

## Add the music

Quake and Quake II played their music from the CD's audio tracks. To play the
CD's music, or any other, with a game, put the tracks in a `music` folder in the
game's own, `/groups/users/quake/<game>/music`: drop the folder on the Games page
and choose the game, or copy it there with EiN's files or `scp`. Ogg, MP3, or
whatever else the browser plays. The game's card then says **music**. A game without its own music plays none: the
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
attribute is empty, so EiN's media pipelines leave the music alone. **Delete
game**, in the ⋮ menu of the game's page, deletes it for everyone; one of the
free ones is offered again once it is gone.

In EiN's terminal, `quake-games` lists the games with their titles, engines,
paks, maps and music, and the free ones not fetched yet; `games-list` lists them
with every other game module's. `quake-fetch shareware`, `quake-fetch
quake2-demo` or `quake-fetch librequake` fetches one of the free ones, as
**Fetch** does.

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

| Path                                                                              | What it is for                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mod.json`                                                                        | The manifest: the games module it needs, and the routes of a game's page and the dashboard card.                                                                                             |
| `etc/games.d/games.json`                                                          | What the games module knows of the module: its title, icon and route, its list and fetch commands, its games folder, the files it takes when dropped, and how its games are played together. |
| `ui/pages/game.tsx`                                                               | A game's page, `/games/quake/<game>`: the games module's page for a game, with the module's adapter.                                                                                         |
| `ui/cards/demo.tsx`                                                               | The dashboard card, offered in `etc/dashboard.d/cards.json`: the games module's demo card, a game running its demos.                                                                         |
| `ui/adapter.ts`                                                                   | The adapter the games module plays the games with: lists them, starts one, maps the keys, the mouse and the wheel, and names the saves kept.                                                 |
| `ui/quake/engine.ts`                                                              | Loads the game's engine, its glue and wasm, the paks and the files beside them, and wraps the engine's exports; what differs between the engines.                                            |
| `ui/quake/keys.ts`                                                                | Browser key codes and mouse buttons to Quake's, which are Quake II's too.                                                                                                                    |
| `bin/quake-games`                                                                 | Lists the games with their titles, engines, title art, paks, maps and music, and the free ones not fetched yet, for the Games page, a game's page and the card's choice of game.             |
| `lib/games.ts`, `lib/api.ts`                                                      | Where the games are, which engine plays a game, its maps and music, the games known by name, the free games offered, and the shape `quake-games` answers in.                                 |
| `lib/catalog.ts`                                                                  | Reads the games folder: each game's paks, the files beside them, and what `quake-games` says of it.                                                                                          |
| `lib/cover.ts`                                                                    | Decodes a game's title art out of its console background, Quake's with its palette, Quake II's a PCX, reading only those, as a PNG.                                                          |
| `lib/paks.ts`                                                                     | Reads a pak's header and directory and the files in it, and packs a pak.                                                                                                                     |
| `bin/quake-fetch`                                                                 | Fetches one of the free games into the games folder, checked against its release's SHA-256.                                                                                                  |
| `bin/quake-server`, `services/quake-server/`                                      | The service that runs the hosted games with the games module's `GameServers`: `lib/server.ts` runs each server in a worker (`lib/server-worker.ts`).                                         |
| `engine/quakegeneric_ein.c`                                                       | quakegeneric's platform layer for the page: the frame, keys, mouse and start-up.                                                                                                             |
| `engine/sys_ein.c`                                                                | The system driver: files, the clock, and Quit and errors that end the game.                                                                                                                  |
| `engine/snd_ein.c`                                                                | The sound card: the ring Quake's mixer paints, handed to the page.                                                                                                                           |
| `engine/cd_ein.c`                                                                 | The CD player: tracks and their volume, handed to the page.                                                                                                                                  |
| `engine/Containerfile`                                                            | Quake's build: pinned emsdk image, quakegeneric commit and id's Quake source, for the sound.                                                                                                 |
| `engine/resolution.patch`                                                         | Makes the frame's size the mode the player chooses, up to the build's, with Video Options, and a field of view as wide as the frame.                                                         |
| `engine/scale.patch`                                                              | Draws the menus, the status bar and the console at a scale of the frame's height, so they keep their size.                                                                                   |
| `engine/files.patch`                                                              | Tells the page when Quake has saved a game or written its settings, so it can keep them.                                                                                                     |
| `engine/long-strings.patch`                                                       | Saves strings longer than 256 bytes, as LibreQuake's are, instead of overrunning the buffer they were written into.                                                                          |
| `engine/net_ein.c`, `engine/connect.patch`                                        | Quake's network: the loopback, and id's datagram driver over the page's or the worker's; connecting without waiting in a loop for answers.                                                   |
| `engine/menu.patch`                                                               | Makes the main menu's Multiplayer the player's setup, without the menu of joining and starting a game, which the page does.                                                                  |
| `engine/server_ein.c`, `engine/build.sh`                                          | Quake's dedicated server's platform layer, and the build of the game and the server.                                                                                                         |
| `engine/quake2/quake2generic_ein.c`                                               | quake2generic's platform layer for the page: the frame at the video mode's size, keys, mouse and start-up.                                                                                   |
| `engine/quake2/snd_ein.c`, `engine/quake2/cd_ein.c`                               | Quake II's sound card and CD player, as Quake's.                                                                                                                                             |
| `engine/quake2/Containerfile`                                                     | Quake II's build: pinned emsdk image and quake2generic commit.                                                                                                                               |
| `engine/quake2/signatures.patch`                                                  | Gives two of the game code's functions the parameters they are called with, which WebAssembly holds them to.                                                                                 |
| `engine/quake2/volume.patch`                                                      | The mixer's volume of an 8-bit sound, which quake2generic had made silent.                                                                                                                   |
| `engine/quake2/files.patch`                                                       | Lists a folder's files, which saving a game needs, and tells the page when Quake II has saved a game or written its settings.                                                                |
| `engine/quake2/menu.patch`                                                        | Makes the main menu's Multiplayer the player setup, without the menus of joining and starting a server, which the page does.                                                                 |
| `engine/quake2/video.patch`                                                       | Leaves the driver, fullscreen and windowed mouse out of the Video menu, which would change nothing in the page.                                                                              |
| `engine/quake2/widescreen.patch`                                                  | Adds the widescreen modes up to 1920 by 1200, and a field of view as wide as the frame.                                                                                                      |
| `engine/quake2/scale.patch`                                                       | Draws the menus, the HUD and the console at a scale of the frame's height, so they keep their size.                                                                                          |
| `engine/quake2/net_ein.c`, `engine/quake2/server_ein.c`, `engine/quake2/build.sh` | Quake II's network, its dedicated server's platform layer, and the build of the game and the server.                                                                                         |
| `assets/icon.svg`                                                                 | The Q of Quake, drawn for the module: its icon on the Games page and the dashboard card's, filled with the text colour.                                                                      |
| `assets/quake.js`, `assets/quake.wasm`, `assets/quake2.js`, `assets/quake2.wasm`  | The built engines, committed, since a module is installed as its repository stands. `assets/quake-build.txt` and `assets/quake2-build.txt` say what built them.                              |
| `assets/quake-server.*`, `assets/quake2-server.*`                                 | The built dedicated servers, which the quake-server service runs.                                                                                                                            |
| `scripts/build-engine.sh`                                                         | Rebuilds both engines into `assets/`.                                                                                                                                                        |
| `test/smoke.mjs`                                                                  | Signs in with headless Chrome, plays a little, saves screenshots.                                                                                                                            |
| `deno.jsonc`                                                                      | Generated from `mod.json` by core's `deno task sync:modules`, for type-checking in a core checkout.                                                                                          |

## Building the engine

Needs only docker with buildx, or podman; nothing is installed on the host.

    scripts/build-engine.sh

It builds `engine/Containerfile` and `engine/quake2/Containerfile` and exports
the results into `assets/` with the local exporter: each engine twice, the game
and its dedicated server (`engine/build.sh`, `engine/quake2/build.sh`). The source of the committed
`assets/quake.wasm` is quakegeneric at the commit `engine/Containerfile` pins,
with `engine/resolution.patch`, `engine/scale.patch`, `engine/files.patch` and
`engine/long-strings.patch` applied, id Software's `snd_dma.c`, `snd_mem.c`,
`snd_mix.c` and `net_dgrm.c` from WinQuake at the commit it pins, with
`engine/connect.patch` and `engine/menu.patch` applied, and the `engine/` files
added.
The source of `assets/quake2.wasm` is quake2generic at the commit
`engine/quake2/Containerfile` pins, with `engine/quake2/signatures.patch`,
`engine/quake2/volume.patch`, `engine/quake2/files.patch`,
`engine/quake2/menu.patch`, `engine/quake2/video.patch`,
`engine/quake2/widescreen.patch` and `engine/quake2/scale.patch` applied and the
`engine/quake2/` files added.

## Developing

Mount the checkout read-only in EiN's container as `/modules-dev/quake` and set
`DEV_MODULES_PATH=/modules-dev`; EiN sets the module up when it starts, and it
runs instead of an installed one. The folder must be called `quake`, the
module's name. The games module has to be there too, installed or mounted beside
it. After a change under `ui/`, run `ui-build quake` in EiN's terminal
and reload the browser; after a change to `mod.json`,
`mod setup quake`. A file in `assets/` is read as it is.

The smoke test wants a running EiN with the games module, this one and a game
(`--game`, the shareware episode's folder when not given), Google Chrome, and
Node 22 or later:

    EIN_PASSWORD=... CHROME=/usr/bin/google-chrome node test/smoke.mjs --game shareware --out /some/directory

## Licence

GPL-2.0-or-later, as quakegeneric, quake2generic and id's source are: see
`LICENSE`. Quake's and Quake II's source is © id Software and the quakegeneric
and quake2generic authors; their notices are in the source the builds fetch.
`assets/quake.js`, `assets/quake2.js` and the servers' `.js` are Emscripten's runtime, under the MIT
licence. `assets/icon.svg` is the module's own drawing of Quake's Q, which is id
Software's trademark. The module fetches, when asked, and does not ship the games: Quake's
shareware episode is id Software's, under its own shareware licence; Quake II's
demo is id Software's, under its own demo licence, which is fetched with it; and
LibreQuake is under the BSD licence, its game code under the GPL.
