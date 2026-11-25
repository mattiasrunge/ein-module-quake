/**
 * Where the game data is: a folder in the household's shared home, so everyone signed in plays the
 * same games and may add to them. Each folder in it with a `pak0.pak` is a game, as Quake's `id1`
 * is: its paks, and in `music/` the CD's tracks, when it has music. The module's services put the
 * shareware episode and LibreQuake here when the module is installed; a folder dropped on the page
 * is uploaded here.
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
 * The tracks among the files `names`, by the number Quake asks for: the CD's, on which track 1 was
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

/** id's `pak0.pak` of Quake 1.06, the shareware episode's and the whole game's alike; `pak1.pak` is the rest of the game. */
const QUAKE_PAK0_SIZE = 18689235;

/** The games the list knows by their folder's name, in the order the list has them. */
const KNOWN: Record<string, string> = {
  librequake: 'LibreQuake',
};

/** The title of the game in folder `name` with paks of `sizes` bytes, in their order. */
export function titleOf(name: string, sizes: number[]): string {
  if (sizes[0] === QUAKE_PAK0_SIZE) return sizes.length > 1 ? 'Quake' : 'Quake (shareware)';
  return KNOWN[name.toLowerCase()] ?? name;
}

/** id's Quake first, the episode before the whole game, then the games known by name, then the rest by name. */
const rank = (title: string) => title === 'Quake (shareware)' ? 0 : title === 'Quake' ? 1 : Object.values(KNOWN).includes(title) ? 2 : 3;

export const byRank = (a: { title: string; name: string }, b: { title: string; name: string }): number => rank(a.title) - rank(b.title) || a.name.localeCompare(b.name);
