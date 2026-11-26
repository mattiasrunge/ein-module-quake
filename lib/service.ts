import { type Command, isSocketListener, shq, type SocketConnection, type SocketListener, type SocketPeer, type UserAttrs } from '@ein/client';
import { USERS_PATH } from '@ein/paths';
import type { EngineName, ServerInfo, ServerPlayer } from './api.ts';
import { openReader, readWhole } from './catalog.ts';
import { GAMES, PAK_FILE, SERVERS } from './games.ts';
import { addressNumber, addressText, FRAME_HEADER, MAX_DATAGRAM, playerAddress, Ring } from './net.ts';
import { packPak, PAK_HEADER_SIZE, pakDirectory, pakEntries } from './paks.ts';
import type { FromWorker, StartServer, ToWorker } from './server-worker.ts';
import { messageOf, readServer, serverPath, serverSocket, SHARED_FOLDER_MODE, writeServer } from './servers.ts';

/** Where the module is in EiN's tree: the servers' engines in `assets/`, the worker and the network in `lib/`. */
const MODULE = '/usr/modules/quake';

/** A game nobody has played in this long stops. */
const EMPTY_MS = 5 * 60_000;

/** A game that failed stays listed this long, with why, before its folder goes. */
const FAILED_MS = 60_000;

/** How long a server may take to load its game and start. */
const START_MS = 120_000;

/** How often the service looks over the servers even when nothing in their folders changed: for games left empty. */
const SCAN_MS = 2_000;

/** How much of a player's connection is read at once: a whole frame, so each read is one datagram. */
const CHUNK = FRAME_HEADER + MAX_DATAGRAM;

/** Who may connect to a game's socket: every account, which the service, its owner, listens for. */
const SOCKET_MODE = 0o666;

/**
 * What each engine's dedicated server takes: its game folder, its build in `assets/`, the files of
 * a pak it never reads (sounds, pictures, skins), which are left out of the paks it is given when
 * it says, and its command line for a game.
 */
type ServerSpec = { folder: string; build: string; unread?: RegExp; args(info: ServerInfo): string[] };

const SPECS: Record<EngineName, ServerSpec> = {
  quake2: {
    folder: '/baseq2',
    build: 'quake2-server',
    // Quake 2's server reads its maps and its configuration; models, sounds and pictures it names only.
    unread: /\.(wav|pcx|wal|md2|sp2|cin|tga|jpg|png|ogg|mp3|dm2)$/,
    args: (info) => ['quake2', '+set', 'dedicated', '1', '+set', info.mode, '1', '+set', 'maxclients', String(info.maxPlayers), '+map', info.map],
  },
  quake: {
    folder: '/id1',
    build: 'quake-server',
    // Quake's paks are given whole: one with fewer files than id's is a modified game, which the
    // shareware episode refuses to run.
    // -dedicated sets deathmatch when it has room for more than one; a cooperative game says otherwise.
    args: (info) => ['quake', '-dedicated', String(info.maxPlayers), ...(info.mode === 'coop' ? ['+deathmatch', '0', '+coop', '1'] : []), '+map', info.map],
  },
};

/** A seat being played from: its name, its address in the game, and the connection its player plays over. */
type Seat = { name: string; ip: number; connection: SocketConnection };

/**
 * A game the service runs: its worker, the listener on its socket, the seats played from now by
 * address, the address each seat's name has had, and when someone last played.
 */
type Running = {
  id: string;
  info: ServerInfo;
  worker: Worker;
  /** What the players send, on its way to the worker. */
  ring: Ring;
  started: boolean;
  listener?: SocketListener;
  seats: Map<number, Seat>;
  /** A seat's name keeps its address, so a player who comes back (a page reloaded) is the same player to the game. */
  addresses: Map<string, number>;
  nextSeat: number;
  playedAt: number;
};

/**
 * The quake-server service: runs the games people host, each a dedicated server in a worker of its
 * own, and listens on each game's socket node, carrying each player's datagrams between their
 * connection and the worker. It watches the servers folder: a `server.json` saying `starting` is
 * started, one saying `stopping` is stopped, and a game left empty is taken away. It runs as the
 * administrator, who owns each socket and so listens on it.
 */
export class QuakeService {
  readonly #games = new Map<string, Running>();
  /** Account names by uid, for naming the seats their connections play from. */
  readonly #names = new Map<number, string>();
  /** The games being started: loading their paks takes a while, and a scan meanwhile must not start them again. */
  readonly #starting = new Set<string>();
  #scanning?: Promise<void>;
  #again = false;

  constructor(private readonly cmd: Command) {}

  /** Run until `stopped`, then stop every game. */
  async run(stopped: Promise<void>): Promise<void> {
    await this.#prepare();
    const subscription = await this.cmd.sys.vfs.subscribe?.(() => this.cmd.access, () => this.#schedule(), { pathPrefix: SERVERS });
    const timer = setInterval(() => this.#schedule(), SCAN_MS);
    this.#schedule();
    await stopped;
    clearInterval(timer);
    await subscription?.unsubscribe();
    await this.#scanning;
    for (const id of [...this.#games.keys()]) await this.#stop(id);
  }

  async #log(line: string): Promise<void> {
    await this.cmd.writeLn(`quake-server: ${line}`).catch(() => undefined);
  }

  /** The servers folder, open to every account, and empty: no game outlives the service. */
  async #prepare(): Promise<void> {
    const vfs = this.cmd.sys.vfs;
    if (!(await vfs.exists(this.cmd.access, GAMES))) await this.cmd.execute(`mkdir -p ${shq(GAMES)}`);
    if (!(await vfs.exists(this.cmd.access, SERVERS))) {
      await vfs.create(this.cmd.access, 'directory', GAMES, 'servers', { props: { mode: SHARED_FOLDER_MODE } });
    } else {
      await vfs.update(this.cmd.access, SERVERS, { props: { mode: SHARED_FOLDER_MODE } });
      for (const child of await vfs.children(this.cmd.access, SERVERS)) await this.#remove(`${SERVERS}/${child.name}`);
    }
  }

  /** Look the servers over soon; a look asked for while one runs runs once more after it. */
  #schedule(): void {
    if (this.#scanning) {
      this.#again = true;
      return;
    }
    this.#scanning = (async () => {
      do {
        this.#again = false;
        await this.#scan().catch((error) => this.#log(`looking over the servers failed: ${messageOf(error)}`));
      } while (this.#again);
    })().finally(() => this.#scanning = undefined);
  }

  async #scan(): Promise<void> {
    const vfs = this.cmd.sys.vfs;
    const ids = new Set((await vfs.children(this.cmd.access, SERVERS)).filter((child) => child.node.type === 'directory').map((child) => child.name));
    for (const id of this.#games.keys()) if (!ids.has(id)) await this.#stop(id);
    for (const id of ids) {
      const info = await readServer(this.cmd, id);
      const running = this.#games.get(id);
      if (running) {
        // A server.json read while it is written again (a player came or left) is empty: only `stopping`, or the folder gone, stops the game.
        if (info?.state === 'stopping') await this.#stop(id);
        else if (running.started && Date.now() - running.playedAt > EMPTY_MS) {
          await this.#log(`${id}: nobody has played for ${EMPTY_MS / 60_000} minutes`);
          await this.#stop(id);
        }
      } else if (this.#starting.has(id)) {
        continue;
      } else if (info?.state === 'starting') {
        this.#starting.add(id);
        void this.#start(id, info).finally(() => this.#starting.delete(id));
      } else if (info?.state !== 'failed' || Date.now() - Date.parse(info.startedAt) > FAILED_MS) {
        // Stopped, failed a while ago, left from before, or not a server at all.
        if (info || Date.now() - (await vfs.get(this.cmd.access, serverPath(id))).props.birthtime.timestamp > FAILED_MS) await this.#remove(serverPath(id));
      }
    }
  }

  /** Start the game `info` asks for: its paks, but the files its server never reads, and the server's build, handed to a new worker. */
  async #start(id: string, info: ServerInfo): Promise<void> {
    const spec = SPECS[info.engine];
    const urls: string[] = [];
    const blob = async (path: string, type: string) => {
      const url = URL.createObjectURL(new Blob([await readWhole(this.cmd, path) as Uint8Array<ArrayBuffer>], { type }));
      urls.push(url);
      return url;
    };
    let worker: Worker | undefined;
    try {
      const [paks, wasm, glue, net, code] = await Promise.all([
        this.#paks(info.game, spec.unread),
        readWhole(this.cmd, `${MODULE}/assets/${spec.build}.wasm`),
        blob(`${MODULE}/assets/${spec.build}.js`, 'text/javascript'),
        blob(`${MODULE}/lib/net.ts`, 'application/typescript'),
        blob(`${MODULE}/lib/server-worker.ts`, 'application/typescript'),
      ]);
      worker = new Worker(code, { type: 'module' });
      const ring = new Ring();
      const running: Running = { id, info, worker, ring, started: false, seats: new Map(), addresses: new Map(), nextSeat: 1, playedAt: Date.now() };
      this.#games.set(id, running);
      const started = Promise.withResolvers<void>();
      worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.#heard(running, data, started);
      worker.onerror = (event) => {
        event.preventDefault();
        started.reject(new Error(event.message));
        void this.#failed(running, event.message);
      };
      const start: StartServer = { type: 'start', glue, net, wasm, folder: spec.folder, paks, args: spec.args(info), ring: ring.buffer };
      worker.postMessage(start satisfies ToWorker, [wasm.buffer as ArrayBuffer, ...paks.map((pak) => pak.buffer as ArrayBuffer)]);
      const timeout = setTimeout(() => started.reject(new Error(`the server did not start within ${START_MS / 1000} s`)), START_MS);
      await started.promise.finally(() => clearTimeout(timeout));
      await this.#listen(running);
      running.started = true;
      running.info = { ...info, state: 'running' };
      await writeServer(this.cmd, running.info);
      await this.#log(`${id}: ${info.title} on ${info.map}, ${info.mode}, hosted by ${info.startedBy}`);
      this.#schedule();
    } catch (error) {
      worker?.terminate();
      this.#games.delete(id);
      await this.#log(`${id}: did not start: ${messageOf(error)}`);
      await writeServer(this.cmd, { ...info, state: 'failed', error: messageOf(error) }).catch(() => undefined);
    } finally {
      urls.forEach((url) => URL.revokeObjectURL(url));
    }
  }

  /** The paks of the game in folder `game`, each without its files `unread` matches, or whole without it. */
  async #paks(game: string, unread?: RegExp): Promise<Uint8Array[]> {
    const vfs = this.cmd.sys.vfs;
    const found = new Map<number, string>();
    for (const child of await vfs.children(this.cmd.access, `${GAMES}/${game}`)) {
      const match = PAK_FILE.exec(child.name);
      if (match) found.set(Number(match[1]), child.name);
    }
    const paks: Uint8Array[] = [];
    for (let i = 0; found.has(i); i++) {
      if (!unread) {
        paks.push(await readWhole(this.cmd, `${GAMES}/${game}/${found.get(i)}`));
        continue;
      }
      const reader = await openReader(this.cmd, `${GAMES}/${game}/${found.get(i)}`);
      try {
        const directory = pakDirectory(await reader.read(0, PAK_HEADER_SIZE));
        if (!directory) throw new Error(`${found.get(i)} is not a pak`);
        const files = [];
        for (const entry of pakEntries(await reader.read(directory.offset, directory.length)).values()) {
          if (!unread.test(entry.name.toLowerCase())) files.push({ name: entry.name, data: await reader.read(entry.at, entry.size) });
        }
        paks.push(packPak(files));
      } finally {
        await reader.close();
      }
    }
    if (paks.length === 0) throw new Error(`${game} has no paks`);
    return paks;
  }

  /** What a game's worker said. */
  #heard(running: Running, message: FromWorker, started: PromiseWithResolvers<void>): void {
    switch (message.type) {
      case 'send':
        running.seats.get(message.ip)?.connection.write(message.framed).catch(() => undefined);
        break;
      case 'log':
        if (message.line.trim()) void this.#log(`${running.id}: ${message.line}`);
        break;
      case 'started':
        started.resolve();
        break;
      case 'status':
        void this.#status(running, message.status);
        break;
      case 'ended':
        started.reject(new Error(message.error ?? 'the server quit'));
        if (running.started) void (message.error ? this.#failed(running, message.error) : this.#stop(running.id));
        break;
    }
  }

  /** Who plays, from the server, into `server.json` when it changed. */
  async #status(running: Running, status: string): Promise<void> {
    if (!this.#games.has(running.id)) return;
    const { map, players: found } = JSON.parse(status) as { map: string; players: (Omit<ServerPlayer, 'seat'> & { address: string })[] };
    const names = new Map([...running.addresses].map(([name, ip]) => [ip, name]));
    const players = found.map(({ address, ...player }) => {
      const seat = names.get(addressNumber(address));
      return { ...player, ...(seat ? { seat } : {}) };
    });
    if (players.length > 0) running.playedAt = Date.now();
    if (JSON.stringify(players) === JSON.stringify(running.info.players) && map === running.info.map) return;
    running.info = { ...running.info, map: map || running.info.map, players };
    await writeServer(this.cmd, running.info).catch((error) => this.#log(`${running.id}: server.json not written: ${messageOf(error)}`));
  }

  /** Make the game's socket and listen on it, seating each player who connects until the listener closes. */
  async #listen(running: Running): Promise<void> {
    const vfs = this.cmd.sys.vfs;
    await vfs.create(this.cmd.access, 'socket', serverPath(running.id), 'socket', { props: { mode: SOCKET_MODE } });
    const listener = await vfs.open(this.cmd.access, serverSocket(running.id), { mode: 'r' });
    if (!isSocketListener(listener)) {
      await listener.close();
      throw new Error(`${serverSocket(running.id)} is not a socket`);
    }
    running.listener = listener;
    void (async () => {
      for (let connection = await listener.accept(); connection; connection = await listener.accept()) void this.#seat(running, connection);
    })();
  }

  /**
   * Seat the player of `connection`: under their account's name, or `guest` for an invitation's, the
   * first of it, `-2`, `-3` and on that nobody plays from now, at the address that name had. Pass
   * what they send to the worker until the connection ends.
   */
  async #seat(running: Running, connection: SocketConnection): Promise<void> {
    const base = await this.#nameOf(connection.peer);
    const playing = new Set([...running.seats.values()].map((seat) => seat.name));
    let name = base;
    for (let n = 2; playing.has(name); n++) name = `${base}-${n}`;
    const ip = running.addresses.get(name) ?? addressNumber(playerAddress(running.nextSeat++));
    running.addresses.set(name, ip);
    const seat: Seat = { name, ip, connection };
    running.seats.set(ip, seat);
    await this.#log(`${running.id}: ${name} sits at ${addressText(ip)}`);
    try {
      for (;;) {
        const framed = await connection.read(CHUNK);
        if (framed.length === 0) break;
        // A server too far behind to take more drops what does not fit, as the network would.
        if (framed.length >= FRAME_HEADER) running.ring.write(ip, framed);
      }
    } catch {
      // Closed under the read.
    } finally {
      if (running.seats.get(ip) === seat) running.seats.delete(ip);
      await connection.close().catch(() => undefined);
      await this.#log(`${running.id}: ${name} left`);
    }
  }

  /** The name a connection's seat goes by: `guest` for an invitation's, else the name of the account that connected. */
  async #nameOf(peer: SocketPeer): Promise<string> {
    if (peer.invitation) return 'guest';
    if (!this.#names.has(peer.uid)) {
      for (const child of await this.cmd.sys.vfs.children<UserAttrs>(this.cmd.access, USERS_PATH).catch(() => [])) {
        if (typeof child.node.attrs.uid === 'number') this.#names.set(child.node.attrs.uid, child.name);
      }
    }
    return this.#names.get(peer.uid) ?? `player${peer.uid}`;
  }

  /** The game's server failed: it stays listed a while with why, then goes. */
  async #failed(running: Running, error: string): Promise<void> {
    await this.#log(`${running.id}: failed: ${error}`);
    await this.#end(running);
    await writeServer(this.cmd, { ...running.info, state: 'failed', error, players: [] }).catch(() => undefined);
  }

  /** Stop the game: its worker, its seats, and its folder. */
  async #stop(id: string): Promise<void> {
    const running = this.#games.get(id);
    if (running) {
      await this.#end(running);
      await this.#log(`${id}: stopped`);
    }
    await this.#remove(serverPath(id));
  }

  /** The game ends: its worker, and its listener, which ends every player's connection. */
  async #end(running: Running): Promise<void> {
    this.#games.delete(running.id);
    running.worker.terminate();
    await running.listener?.close();
  }

  async #remove(path: string): Promise<void> {
    const result = await this.cmd.execute(`rm -r ${shq(path)}`);
    if (result.code !== 0 && await this.cmd.sys.vfs.exists(this.cmd.access, path)) await this.#log(`${path} not removed: ${result.stderr.trim()}`);
  }
}
