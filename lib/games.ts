import type { EngineName } from './api.ts';

/**
 * Where the game data is: a folder in the household's shared home, so everyone signed in plays the
 * same games and may add to them. Each folder in it with a `pak0.pak` is a game, as Quake's `id1`
 * and Quake 2's `baseq2` are: its paks, and in `music/` the CD's tracks, when it has music. The
 * games the page offers (`OFFERS`) are fetched here by `quake-fetch`; a folder dropped on the page is
 * uploaded here.
 */
export const GAMES = '/groups/users/quake';

/** A pak file, `pak<N>.pak` in any case: a DOS install's are `PAK0.PAK`. */
export const PAK_FILE = /^pak(\d+)\.pak$/i;

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

/** A game the page offers to fetch with `quake-fetch`, by the folder it is fetched into. */
export type Offer = { name: string; title: string; about: string; download: number };

/** The games the page offers, while their folders are not there: free ones, for something to play. */
export const OFFERS: Offer[] = [
  { name: 'shareware', title: 'Quake (shareware)', about: "The first episode of id Software's Quake, free to play and pass on.", download: 8_990_046 },
  {
    name: 'quake2-demo',
    title: 'Quake II (demo)',
    about: "The first three levels of id Software's Quake II, free to play at home under its licence, which comes with it; not for showing in public.",
    download: 39_015_499,
  },
  { name: 'librequake', title: 'LibreQuake', about: "Free game data for Quake's engine, with its music.", download: 55_987_573 },
];

/** What the page calls each engine's games. */
export const ENGINE_TITLES: Record<EngineName, string> = { quake: 'Quake', quake2: 'Quake II' };

/** id's `pak0.pak` of Quake 1.06, the shareware episode's and the whole game's alike; `pak1.pak` is the rest of the game. */
const QUAKE_PAK0_SIZE = 18689235;

/** The games the list knows by their folder's name, in the order the list has them. */
const KNOWN: Record<string, string> = {
  librequake: 'LibreQuake',
};

/**
 * The title of the game in folder `name` with paks of `sizes` bytes, in their order, holding
 * `files`. id's Quake is known by its `pak0.pak`, id's Quake 2 by its first map: the demo's
 * `demo1`, the whole game's `base1`.
 */
export function titleOf(name: string, sizes: number[], files: Set<string>): string {
  if (sizes[0] === QUAKE_PAK0_SIZE) return sizes.length > 1 ? 'Quake' : 'Quake (shareware)';
  if (engineOf(files) === 'quake2') {
    if (files.has('maps/base1.bsp')) return 'Quake II';
    if (files.has('maps/demo1.bsp')) return 'Quake II (demo)';
  }
  return KNOWN[name.toLowerCase()] ?? name;
}

/** id's games first, Quake before Quake 2 and each one's demo before the whole game, then the games known by name, then the rest by name. */
const ID_GAMES = ['Quake (shareware)', 'Quake', 'Quake II (demo)', 'Quake II'];
const rank = (title: string) => ID_GAMES.includes(title) ? ID_GAMES.indexOf(title) : Object.values(KNOWN).includes(title) ? ID_GAMES.length : ID_GAMES.length + 1;

export const byRank = (a: { title: string; name: string }, b: { title: string; name: string }): number => rank(a.title) - rank(b.title) || a.name.localeCompare(b.name);
