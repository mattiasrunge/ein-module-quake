# quake

A module for [EiN](https://einhq.eu) that plays Quake, Quake II and Quake III
Arena, and the games made for their engines, in the browser, with sound and
music, alone or together: a game someone hosts runs on
EiN, and others here, or on another EiN they are invited from, join it. Its games
are on EiN's **Games** page, which the games module gives: the module brings the
engines and its games, and the games module the page each is played on, the
saves, the sound, the dropped files and the playing together.

Each game has its engine, built to WebAssembly with Emscripten,
single-threaded, with a platform layer of its own and no SDL:

- Quake's is [quakegeneric](https://github.com/erysdren/quakegeneric), id
  Software's WinQuake made easy to port (`engine/quakegeneric_ein.c`). It draws
  with a WebGL 2 renderer of the module's own (`engine/gl_main.c`), made to
  look as Quake's software renderer looks, or with that software renderer, as
  the player chooses, at 1280 by 720, or the video mode the player chooses.
- Quake II's is [Yamagi Quake II](https://github.com/yquake2/yquake2), the
  community's continuation of id Software's Quake II, with its game code and
  two of its renderers linked in (`engine/quake2/quake2_ein.c`). It draws with
  Yamagi's OpenGL ES 3 renderer on the browser's WebGL 2
  (`engine/quake2/glimp_ein.c`), or with its software renderer, as the player
  chooses in its **Video** menu, at 1280 by 720, or the video mode the player
  chooses. A browser without WebGL 2 plays it with the software renderer.
- Quake 3's is [ioquake3](https://github.com/ioquake/ioq3), the community's
  continuation of id Software's Quake III Arena (`engine/quake3/quake3_ein.c`).
  Quake 3 has no software renderer: it draws with ioquake3's OpenGL 2 renderer
  on the browser's WebGL 2 (`engine/quake3/glimp_ein.c`), at 1920 by 1080, or
  the video mode the player chooses. Its game code is the game's own QVMs, in
  its pk3s, which ioquake3's interpreter runs, but for its menus (below).

Each engine runs in the module's worker (`ui/quake/engine-worker.ts`, `ui.workers`
in `mod.json`), not in the page, so a frame the game takes long over never holds
up the page. Both ends are the games module's engine kit: the page starts the
worker with `startWorkerGame` (`@games/worker`), and the worker runs the engine
with `serveEngine` and the kit's Emscripten helpers (`@games/engine`); what the
module adds is each engine's start, its files and its frames. The worker reads
the game's paks from EiN a megabyte at a time as the engine asks for them, with
range requests, so a game starts without downloading all of it: a level of the
whole Quake II reads some 18 MB of its 208, one of Quake some 13 MB of its 53.
The browser keeps what it read, so the next start reads it from there.

The module tells the games apart by what their paks hold: a folder of pk3s is a
Quake 3 game. Its adapter (`ui/adapter.ts`) starts the game's engine, from the
module's `assets/` directory, in the worker, and hands it to the games module's
page, which ticks it from `requestAnimationFrame` and draws on a canvas each
frame the worker hands back as a picture: Quake 3 draws its own with WebGL on
the worker's canvas, and Quake and Quake II do too unless the player chose their
software renderers, whose pixels the worker puts on a canvas of their own.
The sound the engine mixes, and its music, are played by the page.

It is not one of EiN's own modules and has nothing to do with a family's
archive.

## Install

It needs EiN's games module (`games`, 0.1.2-dev.8 or later). As an administrator, open
**Settings → Modules**, choose **Install**, and give
`https://github.com/mattiasrunge/ein-module-quake` under **From a repository**.

The games are on the **Games** page, under Browse in the sidebar, a card each.
The module comes with no games. Until they are there, the Games page offers
five free ones under **Free to fetch**, each with a **Fetch** button for an
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
- **Quake III Arena (demo)**: the demo of id Software's Quake III Arena, four
  of its arenas, which id let anyone copy and pass on free of charge and not
  for profit with its licence. The licence is beside it, `license.txt` in its
  folder. Its own game code is older than ioquake3 runs, so it is played with
  ioquake3's, built from its source with the engine (`assets/quake3-game.pk3`),
  as ioquake3 says to, which notes that the demo's bot files do not wholly match
  it.
- **OpenArena**: [OpenArena](https://openarena.ws) 0.8.8, a free arena shooter
  for Quake 3's engine, under the GPL: its own arenas, characters, weapons, bots
  and music. Its release is 425 MB, for every platform; only its game data is
  kept, its pk3s (390 MB) but `pak2-players-mature.pk3`, which puts more
  revealing models of some of its characters in place of its own. A game reads
  of it only what it shows: its menus some 23 MB, an arena some 50 MB more.

## Play

Each game's card on the Games page has its title art, read out of its paks, and
under its title whether it is a Quake, a Quake II or a Quake III game, its size
and whether it has music (a Quake III game's music is in its pk3s, so its card
says how many arenas it has instead). A Quake III game's title art is the
picture its menus show of one of its arenas. Choose one to open its page, `/games/quake/<game>`, and **Play**
to play it. **Play on a map**, in the page's header, starts the game on the map
you choose instead, without its demos and menus.

Click the game to give it the mouse and the keyboard: the browser hides the
pointer and the mouse turns and looks, as players have played since (`+mlook`
in Quake, free look in Quake II). The left button fires, the right button walks
forward, and the wheel changes weapon, up to the next and down to the one before,
in all three games. WASD or
the arrows move, Space jumps, Shift runs, Alt strafes, Escape opens the game's
menu, and the key under Escape (`` ` ``) its console. While the game has the
mouse or the focus it takes its keys before EiN does, Alt+letter included. Quit
in the game's menu leaves the page as it was before **Play**.

Where a mouse and keyboard play and the page is wide enough, its header shows
your keys: the ones you move, jump and run with, what the mouse's buttons and
wheel do, the menu's and the console's keys, and F11, which is also the
fullscreen button there. **⋮** > **Keys** shows them on any width. They are the
game's own binds, read from your settings and shown again as the game writes
them; you change them in the game: **Options** > **Customize controls** in
Quake and Quake II, **Setup** > **Controls** in Quake III. Each of the three
has the next and the previous weapon there, and its options turn the crosshair
on and off (**Options** > **Crosshair** in Quake, **crosshair** in Quake II,
**Setup** > **Game Options** in Quake III).

In the page, the mouse is yours while the game's menu or console is up, and
the game's again when you close it. If the browser does not hand the mouse back
then (Chrome does not after you let it go with Escape), click the game. Quake
III's menus have a pointer of their own, which the mouse moves, so there the
game keeps the mouse in its menus too; only its console, and a map loading,
give it back.

Fullscreen is in the game's video menu: **Options** > **Video Options** >
**Fullscreen** in Quake, **Video** > **fullscreen** and **apply** in Quake II,
**Setup** > **System** > **Fullscreen** and **Accept** in Quake III.
F11, or the button in the page's header, turns it on and off as well. In
fullscreen the game keeps the mouse, and Escape only opens and closes its menu;
turn fullscreen off in the menu, press F11, or quit the game to leave. A game
always starts in the page, since a browser goes fullscreen only when you press
a key or click. That Escape stays the game's takes Chrome or Edge, with EiN's
address starting `https://` (or on the computer EiN runs on), where holding
Escape still leaves fullscreen; elsewhere, and in Firefox and Safari, Escape
leaves fullscreen, and the game carries on in the page with its menu open. The
header's other buttons turn the sound off and on.

A player who has played before starts with their own settings: the game's
**Options** and the keys bound in its controls menu are kept (below), and the
WASD keys, free look, always run and the crosshair are only the first settings
of a player who has none yet. The wheel is the weapons' too for a player whose
settings leave it unbound, or bound the other way round, as Quake III's own
defaults have it, and the right button walks forward for a player whose settings
leave it unbound or strafing, as Quake III's own defaults have it. Until you choose a name in the game's
**Multiplayer** menu, you play under your account's.

The game's frame is 1280 by 720 in Quake and Quake II, and 1920 by 1080 in
Quake III, until you choose another size, which the game keeps; a player who has
played before keeps the size they had. In Quake, **Options** > **Video Options**
lists the modes, from 320 by 240 up to 1920 by 1200, 4:3 and widescreen (16:9
and 16:10); **Enter** sets the one under the cursor. A wider frame sees more at
its sides, not less above and below. The console's `vid_width` and `vid_height`
set any size up to 1920 by 1200. In Quake II, **Video** > **video mode** sets the
frame's size, from 320 by 240 up to 1920 by 1200, or **auto**, the screen's, in
its pixels, but no wider than 1920, once you choose **apply**. The page shows
the frame at its shape. A larger frame takes more of the computer to draw.

Quake II draws with WebGL 2, the browser's 3D graphics, until you choose
otherwise: **Video** > **renderer** chooses **WebGL 2** or **Software**, Quake II's
own renderer, which draws as it did in 1997, and **apply** starts the game's
video again with it, where you are in the game; the game keeps your choice. A
browser that has no WebGL 2 draws with the software renderer, and its menu
offers only that. With WebGL 2 the textures are filtered trilinearly and
anisotropically, as sharp as the browser offers (16x on most), which **texture
filter** and **aniso filtering** change.

Quake draws with WebGL 2 unless the player chooses otherwise: **Options** >
**Video Options** > **Renderer** switches between **WebGL** and **Software**,
the original software renderer, at once and without leaving the game (the
console's `vid_renderer gl` or `soft`). The WebGL renderer draws as the
software renderer does, through Quake's palette and colormap, so the light falls
in its bands, the fullbright parts of the textures glow and the light reaches
twice a texture's own brightness, as it did on the software renderer and not
on GLQuake; the water, the slime, the lava and the sky move as they did there,
the view under water sways as it did there, at the frame's size, and the
particles are its squares. It draws more of the computer's graphics card and
less of its processor, each pixel in perspective, and its textures' smaller
mip levels farther than the software renderer chose them, per pixel rather than
per surface. **Filtering**, below it, chooses **Linear**, the first setting:
textures filtered between their mip levels (trilinear) and, on floors and walls
seen at a slant, along the slope too (`gl_texture_anisotropy`, 8 samples, 1 for
none), with smooth light, as GLQuake drew them but as bright as the software
renderer; or **Nearest**, the software renderer's look (`gl_filter linear` or
`nearest`).

Water is translucent in WebGL, half (`r_wateralpha 0.5`), and slime with it;
lava and teleporters are opaque (`r_slimealpha`, `r_lavaalpha` and
`r_telealpha`, each 0 to follow `r_wateralpha`, as QuakeSpasm has them; 1 is
opaque). id's maps were made for opaque water: their visibility treats water
as a wall, so through translucent water they would show the void and miss the
monsters behind it. On such a map the game sees through its liquids itself:
where a place sees a liquid's surface, it sees what is behind it as well
(`engine/watervis_ein.c`), and the server sends the monsters and items there, so
they are seen through the water too. A map made for translucent water is drawn
by its own visibility. What the monsters see is unchanged. `r_watervis 0` draws
only what the map's own visibility has. The software renderer draws the liquids
opaque. A browser without WebGL 2
draws with the software renderer, and the menu says **no WebGL**. The settings
are kept with the others.

In Quake III, **Setup** > **System** lists the modes by their shape: **Aspect
Ratio** chooses 4:3, 16:9 or 16:10, **Resolution** one of its sizes, from 640 by
480 up to 1920 by 1200, and **Accept** sets it, and **Fullscreen** with it. Its
**Graphics Settings**, from **Very High Quality** to **Fastest**, set the
detail, lighting and filtering, and leave the mode and fullscreen as they are.
The menus have no GL driver, GL extensions, colour depth or texture quality to
choose: the browser's WebGL has one of each. OpenArena's own menus are played
patched alike, with its flares and anisotropic filtering, but without its bloom,
which ioquake3 does not draw. The console's `r_mode -1` with `r_customwidth` and
`r_customheight` sets any size, and `r_mode -2` the size of the screen, in its
pixels, but no wider than 1920. Its menus and status bar are drawn to the
frame's size, as Quake III draws them.

Quake III Arena's and its demo's menus are ioquake3's, built from its source
with the engine (`assets/quake3-ui.pk3`), and OpenArena's are its own 0.8.8 menus
built from its source (`assets/openarena-ui.pk3`), each with the module's changes
to **Setup** > **System**; the rest of each game's code is its own. id's whole
game's menus are the same as its 1.32 point release's, whose source id published
and ioquake3 carries on.

In Quake, the menus, the status bar and the console keep about the
size they have at 640 by 480 on any frame: each of their pixels is a block of the frame's, 2 by 2 at
720 to 1080 lines, 3 by 3 at 1200, so they stay sharp. The console's `vid_scale`
sets the block's size instead (`vid_scale 3` makes them larger at 1080 lines);
`vid_scale 0` goes back to the frame's. In Quake II they are drawn alike, at
**auto** of **Video** > **ui scale**, 2 by 2 at 720 lines and 3 by 3 at 1080,
which sets another size too.

## Play together

Playing together is in the game's page's header, beside the sound and full
screen. **Start server** starts a server of the game that everyone here can play
on: choose the map, deathmatch (everyone against everyone) or cooperative
(together against the monsters), and how many may play, from 2 to 16. A Quake
III game is hosted as a deathmatch, its free for all; it has no cooperative
game. While it
runs, **Play** enters the game on it, for everyone here who has the game, and
says whose server it is and who plays; the one who started it, or an
administrator, has **Stop server**, which drops everyone in it. A server nobody
has played on for five minutes stops by itself.

The game's own **Multiplayer** menu sets who you are in a game: your name, and
your colours in Quake or your model and skin in Quake II (**player setup**,
beside the keys you play together with). Joining and starting a game are the
page's, so that menu no longer offers them. In Quake III, **Setup**

> **Player** sets your name and model; its own **Multiplayer** menu finds no
> servers, since the page joins them, and a server started there runs in your
> browser, where nobody else reaches it. Its **Single Player** arenas, against
> bots, are played in the browser, as any game on your own.

The game's server runs on EiN, not in anyone's browser: the module's
`quake-server` service runs each hosted game as Quake's, Quake II's or Quake
III's dedicated server, built for it beside the game (`assets/quake-server.wasm`,
`assets/quake2-server.wasm`, `assets/quake3-server.wasm`), in a worker of EiN's
own, so a slow frame never holds up EiN. A Quake III server is given only what
it reads of the game's pk3s, its arenas and their bots' routes, its game code,
scripts and bots, so it holds a fraction of the game; its pk3s are then not its
players', so it asks for none of them (`sv_pure 0`), and each player plays with
their own copy of the game. Its players see a warning that they lack its pk3s,
which they may pass over. The games module's `GameServers` does the rest: it listens on each
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

The game's own console works as well: `status`, `say`, `kill`. A Quake III
game's server runs no bots of its own.

## Saved games and settings

The game's **Save** and **Load** keep your games in your home, in
`.quake/<game>/`, one folder for each game you play, so a save is loaded only
into the game it was made in and nobody else sees it. Beside them is
`config.cfg`, the game's settings and key bindings, written each time you close
the game's menu or console, where they change, when you quit the game, and when
you go to another page of EiN's.

- Quake's slots are a file each, `s0.sav` to `s11.sav`, as Quake writes them.
- Quake II's are a folder each, `save/<slot>/`, as Quake II writes them: the
  game's `server.ssv` and `game.ssv`, and a `.sav` and a `.sv2` for each level
  of the unit you have been to. `save/save0` is the save Quake II makes itself
  when a new unit starts. A slot saved again replaces all of what was kept of
  it. A save holds the game code's own places in the engine, so one made with
  an earlier release of this module's Quake II may not load into a later one.

- Quake III keeps no saved games, only its settings, `q3config.cfg`, written
  whenever they change, and for id's whole game your CD key, `q3key`. A game
  played standalone, the demo or one of its own as OpenArena is, has no key.

Without an account, saves and settings last only as long as the page.

## On a dashboard

With EiN's Dashboards module, add the **Quake** card to a dashboard and choose
its game, one of those installed. The card plays the game as it does when nobody plays: the demos
recorded in its paks, one after the other. It makes no sound and takes no keys.
Quake III plays no demos when nobody plays, so its card shows its main menu.

## Add your own games

A game is a folder of paks, as Quake's `id1` and Quake II's `baseq2` are:
`pak0.pak`, and `pak1.pak` and on when it has them. Drag the folder from your
computer and drop it anywhere on the Games page; it is uploaded, paks and all,
and appears as a card under the folder's name.

The Games page's **?** (**How to add games**) says the same in short: which
folders, files and music the module takes (`etc/games.d/help.md`).

The Games page knows what else of a game's is dropped on it, and asks which game
it goes into when more than one could take it:

- a Quake map (a `.bsp` of Quake's) into a Quake game's `maps/` folder, a
  Quake II map into a Quake II game's, and a Quake III map into a Quake III
  game's. **Play on a map** and **Start server**
  then offer it. Quake's shareware episode plays only the maps in its paks, so
  give a map to the whole game or to LibreQuake.
- another pak, `pak1.pak` and on, into a game's folder.
- a pk3 into a Quake III game's folder: a map someone made comes as one, with
  its textures and levelshot, and Quake III loads every pk3 in the folder.
- a `q3key` or `key.txt` into a Quake III game's folder, its CD key.
- a folder called `music` into a game's folder (below).

Which engine plays it, the paks say: a folder of pk3s and no `pak0.pak` is a
Quake III game; a game whose paks have Quake II's pictures (`pics/`), wall
textures (`.wal`), models (`.md2`) or players' skins (`players/`) is a Quake II
game, and any other a Quake one.

- id's whole Quake: drop the `id1` folder of your Quake 1.06. The list calls a
  folder with id's `pak0.pak` and a `pak1.pak` **Quake**.
- To make the shareware episode the whole game, drop the whole game's `pak1.pak`
  on the Games page and choose the shareware episode: id's `pak0.pak` is the same
  in both.
- id's whole Quake II: drop the `baseq2` folder of your Quake II, 3.20 or
  later. The list calls a Quake II game with the map `base1` **Quake II**. Its
  single-player game is played; the mission packs, and mods with game code of
  their own (a `gamex86.dll`), are not yet.
- id's whole Quake III Arena: drop the `baseq3` folder of your Quake III Arena,
  with `pak0.pk3` and the 1.32 point release's `pak1.pk3` to `pak8.pk3`. The
  list calls a Quake III game with the arena `q3dm0` **Quake III Arena**. Its
  CD key can come with it: a `q3key` file in the folder, as Quake III Arena
  writes it, or a `key.txt` with the key on a line of its own (`ABCD-EFGH-…`,
  with dashes or spaces or without); everyone here then plays with it. Without
  one, its menus ask each player for a key the first time, as Quake III Arena
  did, and keep it with their settings (below); a player's own key comes before
  the folder's. Its mission pack, Team Arena, is not played yet.
- A game of its own for Quake 3's engine, as OpenArena is: drop the folder of
  its pk3s. It is played in a folder named as its own, as ioquake3 plays a game
  that is not id's.

## Add the music

Quake III plays its music from files in its pk3s, so it needs nothing here.
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
quake2-demo`, `quake-fetch librequake`, `quake-fetch quake3-demo` or
`quake-fetch openarena` fetches one of the free ones, as **Fetch** does. It downloads and unpacks the release in a
hidden folder of the games folder, `.fetch-<game>`, which it removes once the
game is in its own.

## Sound

The sound effects are each game's own mixer, id's `snd_dma.c` and `snd_mix.c`,
painting a ring of samples ahead of where the page plays it, as it painted a
sound card's DMA buffer; Web Audio plays the ring. The games played their music
from the CD's audio tracks; here the page plays the game's file for the track
the game asks for. Quake III's mixer mixes its music too, from the Ogg Vorbis
files in its pk3s, into the same ring. The browser plays the files itself (Ogg in Safari from 18.4).
Quake II's mix passes a limiter before it is cut to 16 bits, so sounds that pile up, as the
earthquake's rumble does, are turned down rather than distorted.
In Quake, **Options → Sound Volume** and **CD Music Volume** set the effects and
the music; in Quake II, **Options → effects volume** and **music volume** set
them, and **music** turns the music on and off.

## Layout

| Path                                                                              | What it is for                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mod.json`                                                                        | The manifest: the games module it needs, and the routes of a game's page and the dashboard card.                                                                                                                                  |
| `etc/games.d/games.json`                                                          | What the games module knows of the module: its title, icon and route, its list and fetch commands, its games folder, the files it takes when dropped, and how its games are played together.                                      |
| `etc/games.d/help.md`                                                             | How to add games, their music and maps, which the Games page's **?** shows.                                                                                                                                                       |
| `ui/pages/game.tsx`                                                               | A game's page, `/games/quake/<game>`: the games module's page for a game, with the module's adapter.                                                                                                                              |
| `ui/cards/demo.tsx`                                                               | The dashboard card, offered in `etc/dashboard.d/cards.json`: the games module's demo card, a game running its demos.                                                                                                              |
| `ui/adapter.ts`                                                                   | The adapter the games module plays the games with: lists them, starts one, maps the keys, the mouse and the wheel, and names the saves kept.                                                                                      |
| `ui/quake/engine.ts`, `ui/quake/quake3.ts`                                        | Start Quake and Quake II, and Quake III, in the engine worker with the games module's `startWorkerGame`: what each is given, its command line and its keys; Quake III's the characters they type too, and the household's CD key. |
| `ui/quake/typing.ts`                                                              | The keys of Yamagi Quake II and Quake III, with the characters they type for the console and the menus' fields.                                                                                                                   |
| `ui/quake/files.ts`                                                               | The engines' builds in `assets/`, and a game's paks, read as the engine asks, and the files beside them, fetched whole.                                                                                                           |
| `ui/quake/engine-worker.ts`, `ui/quake/start.ts`                                  | The worker every engine runs in (`ui.workers` in `mod.json`), on the games module's `serveEngine`: each engine's start call, its frame from WebGL or from its memory, its sound and its input; and what the page starts it with.  |
| `ui/quake/keys.ts`                                                                | Browser key codes and mouse buttons to Quake's, and to Quake III's, which are Yamagi Quake II's too, with the characters they type.                                                                                               |
| `ui/quake/binds.ts`                                                               | The player's binds in config.cfg and q3config.cfg, and the binds every game shares: the wheel's and the right button's.                                                                                                           |
| `ui/quake/pad.tsx`                                                                | The keys' drawing the games page shows: the player's binds on the keyboard and the mouse.                                                                                                                                         |
| `bin/quake-games`                                                                 | Lists the games with their titles, engines, title art, paks, maps and music, and the free ones not fetched yet, for the Games page, a game's page and the card's choice of game.                                                  |
| `lib/games.ts`, `lib/api.ts`                                                      | Where the games are, which engine plays a game, its maps and music, the games known by name, the free games offered, and the shape `quake-games` answers in.                                                                      |
| `lib/catalog.ts`                                                                  | Reads the games folder: each game's paks, the files beside them, and what `quake-games` says of it.                                                                                                                               |
| `lib/cover.ts`                                                                    | Decodes a game's title art out of its console background, Quake's with its palette, Quake II's a PCX, reading only those, as a PNG.                                                                                               |
| `lib/paks.ts`                                                                     | Reads a pak's header and directory and the files in it, and packs a pak.                                                                                                                                                          |
| `lib/pk3.ts`                                                                      | Reads a pk3's central directory and the files in it, and trims a pk3 to the files a Quake III server reads.                                                                                                                       |
| `bin/quake-fetch`                                                                 | Fetches one of the free games into the games folder, checked against its release's SHA-256.                                                                                                                                       |
| `bin/quake-server`, `services/quake-server/`                                      | The service that runs the hosted games with the games module's `GameServers`: `lib/server.ts` runs each server in a worker (`lib/server-worker.ts`).                                                                              |
| `engine/quakegeneric_ein.c`                                                       | quakegeneric's platform layer for the page: the frame, keys, mouse, start-up, and whether a menu is up and the frame fullscreen.                                                                                                  |
| `engine/gl_main.c`                                                                | Quake's WebGL 2 renderer: the context on the worker's canvas, the view, and the last pass with the 2D, the shifts and the gamma.                                                                                                  |
| `engine/gl_world.c`                                                               | The WebGL renderer's world and brush models: their surfaces, lightmaps, water and sky.                                                                                                                                            |
| `engine/gl_models.c`                                                              | The WebGL renderer's alias models, sprites and particles.                                                                                                                                                                         |
| `engine/gl_shaders.c`                                                             | The WebGL renderer's GLSL ES 3.00 shaders. `engine/gl_null.c` is the dedicated server's, which draws nothing.                                                                                                                     |
| `engine/watervis_ein.c`                                                           | What a leaf sees through liquids on a map vised as if they were walls, for translucent water.                                                                                                                                     |
| `engine/sys_ein.c`                                                                | The system driver: files, the clock, and Quit and errors that end the game.                                                                                                                                                       |
| `engine/snd_ein.c`                                                                | The sound card: the ring Quake's mixer paints, handed to the page.                                                                                                                                                                |
| `engine/cd_ein.c`                                                                 | The CD player: tracks and their volume, handed to the page.                                                                                                                                                                       |
| `engine/Containerfile`                                                            | Quake's build: pinned emsdk image, quakegeneric commit and id's Quake source, for the sound.                                                                                                                                      |
| `engine/resolution.patch`                                                         | Makes the frame's size the mode the player chooses, up to the build's, with Video Options, which also sets fullscreen, and a field of view as wide as the frame.                                                                  |
| `engine/scale.patch`                                                              | Draws the menus, the status bar and the console at a scale of the frame's height, so they keep their size.                                                                                                                        |
| `engine/files.patch`                                                              | Tells the page when Quake has saved a game or written its settings, so it can keep them.                                                                                                                                          |
| `engine/webgl.patch`                                                              | Hands the view, a new map and the particles to the WebGL renderer while it draws, and puts the renderer and its filtering in Video Options.                                                                                       |
| `engine/watervis.patch`                                                           | Has the server send what a player sees through liquids too (`engine/watervis_ein.c`).                                                                                                                                             |
| `engine/long-strings.patch`                                                       | Saves strings longer than 256 bytes, as LibreQuake's are, instead of overrunning the buffer they were written into.                                                                                                               |
| `engine/net_ein.c`, `engine/connect.patch`                                        | Quake's network: the loopback, and id's datagram driver over the page's or the worker's; connecting without waiting in a loop for answers.                                                                                        |
| `engine/controls.patch`                                                           | Puts the previous weapon (`impulse 12`) beside the next in Customize controls, and a Crosshair line in Options.                                                                                                                   |
| `engine/menu.patch`                                                               | Makes the main menu's Multiplayer the player's setup, without the menu of joining and starting a game, which the page does.                                                                                                       |
| `engine/server_ein.c`, `engine/build.sh`                                          | Quake's dedicated server's platform layer, and the build of the game and the server.                                                                                                                                              |
| `engine/quake2/quake2_ein.c`                                                      | Yamagi Quake II's entry for the page: start-up, a frame a tick, keys and the characters they type, and whether a menu is up and the frame fullscreen.                                                                             |
| `engine/quake2/glimp_ein.c`, `engine/quake2/gl3_ein.c`                            | Quake II's video: the WebGL 2 context its OpenGL ES 3 renderer draws with, the software renderer's frame, the mode's size or the screen's.                                                                                        |
| `engine/quake2/input_ein.c`                                                       | The mouse's movement, which looks as the game's own input makes it; no gamepad.                                                                                                                                                   |
| `engine/quake2/ogg_ein.c`                                                         | The music: tracks and their volume, handed to the page; sound effects kept as Ogg Vorbis, decoded.                                                                                                                                |
| `engine/quake2/hunk_ein.c`                                                        | The renderers' model memory, without the mmap WebAssembly has no use for.                                                                                                                                                         |
| `engine/quake2/Containerfile`                                                     | Quake II's build: pinned emsdk image and Yamagi Quake II commit.                                                                                                                                                                  |
| `engine/quake2/main.patch`                                                        | Sets the game up and returns, and runs a frame each time the page asks (`Qcommon_Tick`), rather than looping.                                                                                                                     |
| `engine/quake2/system.patch`                                                      | Calls the game code linked in rather than loading `game.so`, without a server's console input or a binary's folder.                                                                                                               |
| `engine/quake2/renderers.patch`                                                   | Starts the renderers linked in, WebGL 2 by default and software without it, rather than loading `ref_*.so`; fullscreen takes no video restart.                                                                                    |
| `engine/quake2/soft.patch`                                                        | Hands the software renderer's frame to the platform layer rather than to SDL.                                                                                                                                                     |
| `engine/quake2/sound.patch`                                                       | Mixes the sound into a ring the page plays, at the page's rate, rather than one SDL plays, through a limiter.                                                                                                                     |
| `engine/quake2/files.patch`                                                       | Tells the page when Quake II has saved a game or written its settings, so it can keep them.                                                                                                                                       |
| `engine/quake2/menu.patch`                                                        | Makes the Multiplayer menu the player's setup and keys, without the menus of joining and starting a server, which the page does; the Options menu's music is the page's.                                                          |
| `engine/quake2/video.patch`                                                       | Makes the Video menu the page's: the two renderers, modes up to 1920 by 1200, fullscreen yes or no, no vertical sync or multisampling.                                                                                            |
| `engine/quake2/signatures.patch`                                                  | Declares the speed meter's `GetPlayerSpeed` as it is defined, which WebAssembly holds it to.                                                                                                                                      |
| `engine/quake2/net_ein.c`, `engine/quake2/server_ein.c`, `engine/quake2/build.sh` | Quake II's network, its dedicated server's platform layer, and the build of the game, with its game code and two renderers, and the server.                                                                                       |
| `engine/quake3/quake3_ein.c`                                                      | ioquake3's platform layer for the page: start-up, a frame a tick, keys, characters, the mouse, and whether the console is up and the frame fullscreen.                                                                            |
| `engine/quake3/glimp_ein.c`                                                       | Quake III's OpenGL: a WebGL 2 context on the page's canvas for the OpenGL 2 renderer, at the video mode's size or the screen's, and the modes the menus list.                                                                     |
| `engine/quake3/snd_ein.c`, `engine/quake3/net_ein.c`                              | Quake III's sound card, as Quake's, and its network over the page's or the worker's.                                                                                                                                              |
| `engine/quake3/server_ein.c`, `engine/quake3/build.sh`                            | Quake III's dedicated server's platform layer, and the build of the game and the server.                                                                                                                                          |
| `engine/quake3/Containerfile`                                                     | Quake III's build: pinned emsdk image and ioquake3 commit.                                                                                                                                                                        |
| `engine/quake3/main.patch`                                                        | Makes the system layer's main `Sys_Main`, which sets the game up and returns, without SDL.                                                                                                                                        |
| `engine/quake3/frame.patch`                                                       | Returns at once from a frame that is not due yet, rather than waiting for its time.                                                                                                                                               |
| `engine/quake3/config.patch`                                                      | Tells the page when Quake III has written its settings or the CD key, so it can keep them.                                                                                                                                        |
| `engine/quake3/cdkey.patch`                                                       | Asks no CD key of a game played standalone, the demo or a game of its own.                                                                                                                                                        |
| `engine/quake3/truncate.patch`                                                    | Makes a QVM's cast of a float to an int truncate, as C's does, where ioquake3's interpreter rounded it off x86.                                                                                                                   |
| `engine/quake3/graphics.patch`                                                    | Makes ioquake3's Setup > System the page's: the modes the engine offers, no driver, extensions, colour depth or texture bits, presets that leave the mode and fullscreen.                                                         |
| `engine/quake3/openarena-graphics.patch`                                          | The same for OpenArena 0.8.8's Setup > System, without its bloom too.                                                                                                                                                             |
| `engine/quake3/qvms.sh`                                                           | Compiles the menus and game code the module brings to QVMs with ioquake3's compiler and packs them.                                                                                                                               |
| `assets/icon.svg`                                                                 | The Q of Quake, drawn for the module: its icon on the Games page and the dashboard card's, filled with the text colour.                                                                                                           |
| `assets/quake.js`, `assets/quake.wasm`, `assets/quake2.js`, `assets/quake2.wasm`  | The built engines, committed, since a module is installed as its repository stands. `assets/quake-build.txt` and `assets/quake2-build.txt` say what built them.                                                                   |
| `assets/quake3.js`, `assets/quake3.wasm`                                          | Quake III's built engine; `assets/quake3-build.txt` says what built it.                                                                                                                                                           |
| `assets/quake3-ui.pk3`, `assets/quake3-game.pk3`                                  | ioquake3's own menus for Quake III Arena, which the demo and the whole game are played with, and its cgame and qagame, which the demo is played with, as QVMs.                                                                    |
| `assets/openarena-ui.pk3`                                                         | OpenArena 0.8.8's menus, as a QVM, which OpenArena is played with.                                                                                                                                                                |
| `assets/quake-server.*`, `assets/quake2-server.*`, `assets/quake3-server.*`       | The built dedicated servers, which the quake-server service runs.                                                                                                                                                                 |
| `scripts/build-engine.sh`                                                         | Rebuilds the three engines into `assets/`.                                                                                                                                                                                        |
| `test/smoke.mjs`                                                                  | Signs in with headless Chrome, plays a little, saves screenshots.                                                                                                                                                                 |
| `deno.jsonc`                                                                      | Generated from `mod.json` by core's `deno task sync:modules`, for type-checking in a core checkout.                                                                                                                               |

## Building the engine

Needs only docker with buildx, or podman; nothing is installed on the host.

    scripts/build-engine.sh

It builds `engine/Containerfile`, `engine/quake2/Containerfile` and
`engine/quake3/Containerfile` and exports the results into `assets/` with the
local exporter: each engine twice, the game and its dedicated server
(`engine/build.sh`, `engine/quake2/build.sh`, `engine/quake3/build.sh`). The source of the committed
`assets/quake.wasm` is quakegeneric at the commit `engine/Containerfile` pins,
with `engine/resolution.patch`, `engine/scale.patch`, `engine/files.patch` and
`engine/long-strings.patch` applied, id Software's `snd_dma.c`, `snd_mem.c`,
`snd_mix.c` and `net_dgrm.c` from WinQuake at the commit it pins, with
`engine/connect.patch`, `engine/menu.patch`, `engine/controls.patch`,
`engine/webgl.patch` and `engine/watervis.patch` applied, and the `engine/` files added.
The source of `assets/quake2.wasm` is Yamagi Quake II at the commit
`engine/quake2/Containerfile` pins, its 8.70 release, with
`engine/quake2/main.patch`, `engine/quake2/system.patch`,
`engine/quake2/renderers.patch`, `engine/quake2/soft.patch`,
`engine/quake2/sound.patch`, `engine/quake2/files.patch`,
`engine/quake2/menu.patch`, `engine/quake2/video.patch` and
`engine/quake2/signatures.patch` applied and the `engine/quake2/` files added;
it builds Yamagi's sources itself (`engine/quake2/build.sh`) rather than with
Yamagi's Makefile, which links SDL and loads the game code and the renderers as
libraries. Here they are linked in, the game code with its server, the OpenGL ES
3 and the software renderer with the game: each is compiled with every name it
defines prefixed (`game_`, `gles3_`, `soft_`), so their copies of the code they
share stay apart. `assets/quake2-server.wasm` is Yamagi's dedicated server from
the same source, with the same game code.
The source of `assets/quake3.wasm` is ioquake3 at the commit
`engine/quake3/Containerfile` pins, with `engine/quake3/main.patch`,
`engine/quake3/frame.patch`, `engine/quake3/config.patch`,
`engine/quake3/cdkey.patch`, `engine/quake3/truncate.patch` and
`engine/quake3/graphics.patch` applied and the
`engine/quake3/` files added; it builds ioquake3's sources itself
(`engine/quake3/build.sh`) rather than with ioquake3's CMake, which builds the
browser's game with SDL and no dedicated server. `assets/quake3-ui.pk3` and
`assets/quake3-game.pk3` are ioquake3's `baseq3` menus and game code from the
same source, compiled to QVMs with its CMake and its own compiler.
`assets/openarena-ui.pk3` is OpenArena's menus from its game code at the commit
`engine/quake3/Containerfile` pins, the head of its 0.8.8 branch, with
`engine/quake3/openarena-graphics.patch` applied, compiled with the same compiler
as OpenArena's Makefile compiles them (`engine/quake3/qvms.sh`); without the
patch it is byte for byte the `ui.qvm` of OpenArena 0.8.8's
`pak6-patch088.pk3`.

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

GPL-2.0-or-later, as quakegeneric, Yamagi Quake II, ioquake3 and id's source are:
see `LICENSE`. Quake's, Quake II's and Quake III's source is © id Software and
the quakegeneric, Yamagi Quake II and ioquake3 authors; their notices are in the
source the builds fetch. `assets/quake.js`, `assets/quake2.js`,
`assets/quake3.js` and the servers' `.js` are Emscripten's runtime, under the MIT
licence. `assets/icon.svg` is the module's own drawing of Quake's Q, which is id
Software's trademark. The module fetches, when asked, and does not ship the games: Quake's
shareware episode is id Software's, under its own shareware licence; Quake II's
demo is id Software's, under its own demo licence, which is fetched with it;
LibreQuake is under the BSD licence, its game code under the GPL; Quake III
Arena's demo is id Software's, under its own demo licence, which is fetched with
it; and OpenArena is under the GPL.
