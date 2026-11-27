/** Which engine plays a game: Quake's, or Quake II's. A game's `family` on the Games page. */
export type EngineName = 'quake' | 'quake2';

/**
 * A game in the games folder, as `quake-games` answers it: what the Games page reads of it (its
 * `GameEntry`), and what the adapter needs to start it: its paks, the files beside them and its
 * music.
 */
export type InstalledGame = {
  /** The folder's name, which is also how the game's page and a card remember it. */
  id: string;
  /** What the Games page calls it: the game's title when it is one the module knows, else the folder's name. */
  title: string;
  state: 'installed';
  /** The engine that plays it, which the files in its paks say. */
  family: EngineName;
  /** The game's folder. */
  path: string;
  /** Its engine, its size and whether it has music, as the Games page shows them under its title. */
  detail: string;
  /** What the game is, for a game the module knows, shown under its title on its page. */
  description?: string;
  /** Its title art, its console background read out of its paks, as a PNG `data:` URL; none when its paks have none. */
  cover?: string;
  /** The folder's paks, in the order the engine loads them: `pak0.pak`, `pak1.pak` and on, as named in the folder. */
  paks: string[];
  /** Bytes, the paks together. */
  size: number;
  /**
   * The files beside its paks that the engine reads as if they were in them, by their paths in the
   * folder: Quake II's demo has its players' models and skins in `players/` rather than in its pak,
   * and a map dropped on the Games page is in `maps/`.
   */
  files: string[];
  /** Its maps, in its paks and in its `maps/` folder (but Quake's shareware episode's), by the name a game is started on (`q2dm1`, `e1m1`). */
  maps: string[];
  /** Whether it can be hosted: it has maps. */
  hostable: boolean;
  /** The game's music, when it has any: its `music` folder, and the file of each track the game asks for by number. */
  music?: { folder: string; tracks: Record<number, string> };
};

/** A free game the module fetches with `quake-fetch`, while its folder is not there. */
export type OfferedGame = {
  /** The folder it is fetched into, and what `quake-fetch` takes. */
  id: string;
  title: string;
  state: 'offered';
  family: EngineName;
  /** What it is, and the bytes fetching it downloads. */
  about: string;
  download: number;
};

/** A game as `quake-games` answers it: in the games folder, or offered to fetch. */
export type Game = InstalledGame | OfferedGame;
