/** A game in the games folder, as `quake-games` answers it and the page lists it. */
export type Game = {
  /** The folder's name, which is also how the page and a card remember it. */
  name: string;
  /** What the list calls it: the game's title when it is one the module knows, else the folder's name. */
  title: string;
  /** The folder's paks, in the order Quake loads them: `pak0.pak`, `pak1.pak` and on, as named in the folder. */
  paks: string[];
  /** Bytes, the paks together. */
  size: number;
  /** The game's music, when it has any: its `music` folder, and the file of each track Quake asks for by number. */
  music?: { folder: string; tracks: Record<number, string> };
};
