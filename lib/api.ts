/** Which engine plays a game: Quake's, or Quake 2's. */
export type EngineName = 'quake' | 'quake2';

/** A game in the games folder, as `quake-games` answers it and the page lists it. */
export type Game = {
  /** The folder's name, which is also how the page and a card remember it. */
  name: string;
  /** What the list calls it: the game's title when it is one the module knows, else the folder's name. */
  title: string;
  /** The engine that plays it, which the files in its paks say. */
  engine: EngineName;
  /** The folder's paks, in the order the engine loads them: `pak0.pak`, `pak1.pak` and on, as named in the folder. */
  paks: string[];
  /** Bytes, the paks together. */
  size: number;
  /**
   * The files beside its paks that the engine reads as if they were in them, by their paths in the
   * folder: Quake II's demo has its players' models and skins in `players/` rather than in its pak.
   */
  files: string[];
  /** The maps in its paks, by the name a server is started on (`q2dm1`, `e1m1`), for hosting a game. */
  maps: string[];
  /** The game's music, when it has any: its `music` folder, and the file of each track the game asks for by number. */
  music?: { folder: string; tracks: Record<number, string> };
};

/** How a hosted game is played: everyone against everyone, or together against the monsters. */
export type GameMode = 'deathmatch' | 'coop';

/** Someone in a hosted game, as its server sees them. */
export type ServerPlayer = {
  /** The name they play under, their engine's `name`. */
  name: string;
  frags: number;
  /** Milliseconds a datagram takes there and back, as the server measures it. */
  ping: number;
  /** Their seat's folder in the server's `players/`: the account's name, or a guest's. */
  seat?: string;
};

/**
 * A game someone hosts, its `server.json`, as `quake-host` writes it and the quake-server service
 * keeps it: `starting` until the service runs it, then `running`, `stopping` once someone stops it,
 * or `failed` with the reason.
 */
export type ServerInfo = {
  /** The server's folder's name in the servers folder. */
  id: string;
  /** The game's folder, its title and the engine that plays it. */
  game: string;
  title: string;
  engine: EngineName;
  map: string;
  mode: GameMode;
  maxPlayers: number;
  /** Who hosted it, and when (ISO 8601). */
  startedBy: string;
  startedAt: string;
  state: 'starting' | 'running' | 'stopping' | 'failed';
  error?: string;
  players: ServerPlayer[];
};

/**
 * A seat in a hosted game, as `quake-join` and `quake-invite` answer: the two stream nodes that
 * carry the player's datagrams, `in` written by the player and `out` read by them, and the address
 * their engine connects to.
 */
export type Seat = {
  server: string;
  game: string;
  title: string;
  engine: EngineName;
  map: string;
  /** The seat's folder's name in the server's `players/`. */
  seat: string;
  in: string;
  out: string;
  address: string;
};

/**
 * A guest's seat, as `quake-invite` answers: the seat, and the invitation that opens its two streams
 * to someone on another EiN, until `expires` (ISO 8601). `link` is the invitation's path on this
 * EiN's own address, `/__invite/<token>`, followed by `#<engine>:<game>:<map>`, which tells the
 * guest's page which of its own games to play.
 */
export type Invite = Seat & { link: string; expires: string };
