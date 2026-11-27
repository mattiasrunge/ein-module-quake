import type { EngineName, OfferedGame } from './api.ts';

/**
 * Where the game data is: a folder in the household's shared home, so everyone signed in plays the
 * same games and may add to them. Each folder in it with a `pak0.pak` is a game, as Quake's `id1`
 * and Quake II's `baseq2` are: its paks, maps of its own in `maps/`, and in `music/` the CD's
 * tracks, when it has music. Each with pk3s instead is a Quake 3 game, as its `baseq3` is: its pk3s
 * and the files beside them, its music among them. The games the module offers (`OFFERS`) are fetched here by
 * `quake-fetch`; a folder dropped on the Games page is uploaded here.
 */
export const GAMES = '/groups/users/quake';

/** The folders of a game's own beside its paks that hold what the engines read, as they would in a pak. */
export const DATA_FOLDERS = ['players', 'maps', 'models', 'sound', 'pics', 'textures', 'sprites', 'env', 'progs', 'gfx'];

/** The folders Quake 3 reads beside its pk3s as well: its music is a file it plays, not a CD's track. */
export const QUAKE3_FOLDERS = ['scripts', 'levelshots', 'vm', 'botfiles', 'music', 'menu', 'ui', 'video'];

/** A pak file, `pak<N>.pak` in any case: a DOS install's are `PAK0.PAK`. */
export const PAK_FILE = /^pak(\d+)\.pak$/i;

/** A pk3 file, Quake 3's pak, by any name: the engine loads every one in its folder. */
export const PK3_FILE = /\.pk3$/i;

/**
 * A track of the music: a file the browser plays, its name starting with the track's number, after
 * `track` or not: `track02.ogg`, `02 - Quake.mp3`, `Track 2.mp3`.
 */
const TRACK_FILE = /^(?:track\s*)?0*(\d{1,2})(?!\d).*\.(?:ogg|mp3|m4a|aac|flac|opus|wav)$/i;

/**
 * The tracks among the files `names`, by the number the game asks for: the CD's, on which track 1 was
 * the game's data and 2 on its music. A folder whose numbers start at 1 was ripped without the data
 * track, so each of its tracks is the CD's one on. Of two files for one track, the first by name.
 */
export function tracksOf(names: string[]): Record<number, string> {
  const found: [number, string][] = [];
  for (const name of [...names].sort()) {
    const match = TRACK_FILE.exec(name);
    if (match && Number(match[1]) > 0) found.push([Number(match[1]), name]);
  }
  const shift = found.some(([number]) => number === 1) ? 1 : 0;
  const tracks: Record<number, string> = {};
  for (const [number, name] of found) tracks[number + shift] ??= name;
  return tracks;
}

/**
 * Which engine plays a game whose paks hold `files`, lower-case paths: Quake 2's when they have any
 * of its pictures (`pics/`), wall textures (`.wal`), models (`.md2`) or players' skins
 * (`players/`), none of which Quake has; else Quake's.
 */
export function engineOf(files: Iterable<string>): EngineName {
  for (const file of files) {
    if (file.startsWith('pics/') || file.startsWith('players/') || file.endsWith('.wal') || file.endsWith('.md2')) return 'quake2';
  }
  return 'quake';
}

/**
 * The maps among a game's `files`, paths in its paks or its folder, by name: each `maps/<name>.bsp`,
 * but Quake's ammunition boxes and health packs, which are maps of their own (`maps/b_*.bsp`). A map
 * in a pak and in the folder alike is one map.
 */
export function mapsOf(files: Iterable<string>): string[] {
  const maps = new Set<string>();
  for (const file of files) {
    const match = /^maps\/([^/]+)\.bsp$/i.exec(file);
    if (match && !match[1].toLowerCase().startsWith('b_')) maps.add(match[1]);
  }
  return [...maps].sort();
}

/** The games the module offers, while their folders are not there: free ones, for something to play. */
export const OFFERS: OfferedGame[] = [
  {
    id: 'shareware',
    title: 'Quake (shareware)',
    state: 'offered',
    family: 'quake',
    about: "The first episode of id Software's Quake, free to play and pass on.",
    download: 8_990_046,
  },
  {
    id: 'quake2-demo',
    title: 'Quake II (demo)',
    state: 'offered',
    family: 'quake2',
    about: "The first three levels of id Software's Quake II, free to play at home under its licence, which comes with it; not for showing in public.",
    download: 39_015_499,
  },
  { id: 'librequake', title: 'LibreQuake', state: 'offered', family: 'quake', about: "Free game data for Quake's engine, with its music.", download: 55_987_573 },
  {
    id: 'openarena',
    title: 'OpenArena',
    state: 'offered',
    family: 'quake3',
    about: "A free arena shooter for Quake 3's engine, with its maps, bots and music.",
    download: 425_189_255,
  },
];
/** What each engine's games are called. */
export const ENGINE_TITLES: Record<EngineName, string> = { quake: 'Quake', quake2: 'Quake II', quake3: 'Quake III' };

/** id's `pak0.pak` of Quake 1.06, the shareware episode's and the whole game's alike; `pak1.pak` is the rest of the game. */
const QUAKE_PAK0_SIZE = 18689235;

/** What each game the list knows is, by its title, for its page. */
const DESCRIPTIONS: Record<string, string> = {
  'Quake (shareware)': "Dimension of the Doomed, the first episode of id Software's Quake (1996): a gothic first-person shooter in true 3D, free to play and pass on.",
  'Quake': "id Software's 1996 first-person shooter: four episodes of gothic, Lovecraftian horror in true 3D, with music by Trent Reznor and Nine Inch Nails.",
  'Quake II (demo)': "The first three levels of id Software's Quake II (1997): a marine against the cyborg Strogg on their own planet.",
  'Quake II': "id Software's 1997 first-person shooter: a lone marine on Stroggos, breaking the cyborg Strogg's hold, mission by mission.",
  'LibreQuake': "Free game data for Quake's engine, made by its community: new levels, monsters, textures and music, played without id's files.",
  'Quake III Arena (demo)': "Four arenas of id Software's Quake III Arena (1999), the multiplayer shooter: against bots on your own, or each other.",
  'Quake III Arena': "id Software's 1999 arena shooter: fast multiplayer deathmatch in gothic and space arenas, against bots or each other.",
  'OpenArena': "A free arena shooter for Quake 3's engine, made by its community: its own arenas, characters, weapons and music, with bots to play against.",
};

/** What the game titled `title` is, when the list knows it. */
export const descriptionOf = (title: string): string | undefined => DESCRIPTIONS[title];

/** The games the list knows by their folder's name, in the order the list has them. */
const KNOWN: Record<string, string> = {
  librequake: 'LibreQuake',
  openarena: 'OpenArena',
};

/**
 * The title of the game in folder `name` played by `engine`, with paks of `sizes` bytes, in their
 * order, holding `files`. id's Quake is known by its `pak0.pak`, id's Quake 2 by its first map: the
 * demo's `demo1`, the whole game's `base1`; id's Quake 3 by its arenas: the whole game has
 * `q3dm0`, the demo four of the rest; OpenArena by its first arena, `oa_dm1`.
 */
export function titleOf(name: string, engine: EngineName, sizes: number[], files: Set<string>): string {
  if (engine === 'quake' && sizes[0] === QUAKE_PAK0_SIZE) return sizes.length > 1 ? 'Quake' : 'Quake (shareware)';
  if (engine === 'quake2') {
    if (files.has('maps/base1.bsp')) return 'Quake II';
    if (files.has('maps/demo1.bsp')) return 'Quake II (demo)';
  }
  if (engine === 'quake3') {
    if (files.has('maps/q3dm0.bsp')) return 'Quake III Arena';
    if (files.has('maps/q3dm1.bsp')) return 'Quake III Arena (demo)';
    if (files.has('maps/oa_dm1.bsp')) return 'OpenArena';
  }
  return KNOWN[name.toLowerCase()] ?? name;
}

/**
 * The folder the Quake 3 game titled `title`, in the folder `name`, is played in: id's game in
 * `baseq3` and its demo in `demoq3`, where ioquake3 looks for them; OpenArena in `baseoa`, as its own
 * engine has it; any other in a folder named as its own, which ioquake3 plays as a game of its own.
 */
export function gamedirOf(name: string, title: string): string {
  if (title === 'Quake III Arena') return 'baseq3';
  if (title === 'Quake III Arena (demo)') return 'demoq3';
  if (title === 'OpenArena') return 'baseoa';
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'game';
}

/**
 * id's games first, Quake before Quake 2 before Quake 3 and each one's demo before the whole game,
 * then the games known by name, then the rest by name.
 */
const ID_GAMES = ['Quake (shareware)', 'Quake', 'Quake II (demo)', 'Quake II', 'Quake III Arena (demo)', 'Quake III Arena'];
const rank = (title: string) => ID_GAMES.includes(title) ? ID_GAMES.indexOf(title) : Object.values(KNOWN).includes(title) ? ID_GAMES.length : ID_GAMES.length + 1;

export const byRank = (a: { title: string; id: string }, b: { title: string; id: string }): number => rank(a.title) - rank(b.title) || a.id.localeCompare(b.id);
