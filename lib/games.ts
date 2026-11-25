/**
 * Where the game data is: a folder in the household's shared home, so everyone signed in plays the
 * same games and may add to them. Each folder in it with a `pak0.pak` is a game, as Quake's `id1`
 * is: its paks, and the music it has of its own in `music/`. The `music` folder beside the games
 * is what a game without music of its own plays. The module's services put the shareware episode
 * and LibreQuake here when the module is installed; a folder dropped on the page is uploaded here.
 */
export const GAMES = '/groups/users/quake';

/** The music beside the games, played by a game with none of its own. */
export const SHARED_MUSIC = `${GAMES}/music`;

/** A pak file, `pak<N>.pak` in any case: a DOS install's are `PAK0.PAK`. */
export const PAK_FILE = /^pak(\d+)\.pak$/i;

/** A track of the music, as Quake numbers the CD's: track 1 was the game's data, 2 on its music. */
export const TRACK_FILE = /^track\d\d\.ogg$/i;

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
