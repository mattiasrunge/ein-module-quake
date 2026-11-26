import { type Command, isStreamWriter, shq, type StreamWriter } from '@ein/client';
import type { EngineName, ServerInfo, ServerPlayer } from './api.ts';
import { openReader, readWhole } from './catalog.ts';
import { GAMES, PAK_FILE, SERVERS } from './games.ts';
import { addressNumber, addressText, playerAddress } from './net.ts';
import { packPak, PAK_HEADER_SIZE, pakDirectory, pakEntries } from './paks.ts';
import type { FromWorker, StartServer, ToWorker } from './server-worker.ts';
import { messageOf, readServer, seatIn, seatOut, seatsPath, serverPath, SHARED_FOLDER_MODE, writeServer } from './servers.ts';

/** Where the module is in EiN's tree: the servers' engines in `assets/`, the worker and the network in `lib/`. */
const MODULE = '/usr/modules/quake';

/** A game nobody has played in this long stops. */
const EMPTY_MS = 5 * 60_000;

/** A seat nobody has had open in this long, and whose player the server does not list, is taken away. */
const SEAT_IDLE_MS = 60_000;

/** A game that failed stays listed this long, with why, before its folder goes. */
const FAILED_MS = 60_000;

/** How long a server may take to load its game and start. */
const START_MS = 120_000;

/** How often the service looks over the servers even when nothing in their folders changed: for games and seats left empty. */
const SCAN_MS = 2_000;

/** How much of a player's stream is passed on at once. */
const CHUNK = 64 * 1024;

/**
 * What each engine's dedicated server takes: its game folder, its build in `assets/`, the files of
 * a pak it never reads (sounds, pictures, skins, demos), which are left out of the paks it is given,
 * and its command line for a game.
 */
type ServerSpec = { folder: string; build: string; unread: RegExp; args(info: ServerInfo): string[] };

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
    // Quake's server loads the models it precaches and gfx.wad; sounds and demos it never reads.
    unread: /\.(wav|dem|ogg|mp3)$/,
    // -dedicated sets deathmatch when it has room for more than one; a cooperative game says otherwise.
    args: (info) => ['quake', '-dedicated', String(info.maxPlayers), ...(info.mode === 'coop' ? ['+deathmatch', '0', '+coop', '1'] : []), '+map', info.map],
  },
};

/** A seat being played from: its address in the game, the writer of its `out`, and since when nobody has had its `in` open. */
type Seat = { name: string; ip: number; out: StreamWriter; stop: AbortController; idleSince?: number };

/** A game the service runs: its worker, its seats by name and by address, and when someone last played. */
type Running = {
  id: string;
  info: ServerInfo;
  worker: Worker;
  started: boolean;
  seats: Map<string, Seat>;
  byIp: Map<number, Seat>;
  nextSeat: number;
  playedAt: number;
};

/**
 * The quake-server service: runs the games people host, each a dedicated server in a worker of its
 * own, and carries each seat's datagrams between its stream nodes and the worker. It watches the
 * servers folder: a `server.json` saying `starting` is started, one saying `stopping` is stopped,
 * a seat's folder made in `players/` is attached, and a game or a seat left empty is taken away.
 * It runs as the administrator, so it reads every seat's `in` and writes every `out`.
 */
export class QuakeService {
  readonly #games = new Map<string, Running>();
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
        if (!info || info.state === 'stopping') await this.#stop(id);
        else if (running.started && Date.now() - running.playedAt > EMPTY_MS) {
          await this.#log(`${id}: nobody has played for ${EMPTY_MS / 60_000} minutes`);
          await this.#stop(id);
        } else if (running.started) await this.#seats(running);
      } else if (info?.state === 'starting') {
        void this.#start(id, info);
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
      const running: Running = { id, info, worker, started: false, seats: new Map(), byIp: new Map(), nextSeat: 1, playedAt: Date.now() };
      this.#games.set(id, running);
      const started = Promise.withResolvers<void>();
      worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.#heard(running, data, started);
      worker.onerror = (event) => {
        event.preventDefault();
        started.reject(new Error(event.message));
        void this.#failed(running, event.message);
      };
      const start: StartServer = { type: 'start', glue, net, wasm, folder: spec.folder, paks, args: spec.args(info) };
      worker.postMessage(start satisfies ToWorker, [wasm.buffer as ArrayBuffer, ...paks.map((pak) => pak.buffer as ArrayBuffer)]);
      const timeout = setTimeout(() => started.reject(new Error(`the server did not start within ${START_MS / 1000} s`)), START_MS);
      await started.promise.finally(() => clearTimeout(timeout));
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

  /** The paks of the game in folder `game`, each without its files `unread` matches. */
  async #paks(game: string, unread: RegExp): Promise<Uint8Array[]> {
    const vfs = this.cmd.sys.vfs;
    const found = new Map<number, string>();
    for (const child of await vfs.children(this.cmd.access, `${GAMES}/${game}`)) {
      const match = PAK_FILE.exec(child.name);
      if (match) found.set(Number(match[1]), child.name);
    }
    const paks: Uint8Array[] = [];
    for (let i = 0; found.has(i); i++) {
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
        running.byIp.get(message.ip)?.out.write(message.framed).catch(() => undefined);
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
    const players = found.map(({ address, ...player }) => {
      const seat = running.byIp.get(addressNumber(address))?.name;
      return { ...player, ...(seat ? { seat } : {}) };
    });
    if (players.length > 0) running.playedAt = Date.now();
    if (JSON.stringify(players) === JSON.stringify(running.info.players) && map === running.info.map) return;
    running.info = { ...running.info, map: map || running.info.map, players };
    await writeServer(this.cmd, running.info).catch((error) => this.#log(`${running.id}: server.json not written: ${messageOf(error)}`));
  }

  /** Attach the seats made in a game's `players/` since the last look, and take away those gone or left empty. */
  async #seats(running: Running): Promise<void> {
    const vfs = this.cmd.sys.vfs;
    const names = new Set(
      (await vfs.children(this.cmd.access, seatsPath(running.id)).catch(() => [])).filter((child) => child.node.type === 'directory').map((child) => child.name),
    );
    for (const [name, seat] of running.seats) if (!names.has(name)) await this.#detach(running, seat);
    for (const name of names) {
      const seat = running.seats.get(name) ?? await this.#attach(running, name);
      if (!seat) continue;
      const open = await vfs.stat(this.cmd.access, seatIn(running.id, name)).then((stat) => (stat as { writer?: boolean }).writer === true, () => false);
      const playing = running.info.players.some((player) => player.seat === name);
      if (open || playing) seat.idleSince = undefined;
      else if ((seat.idleSince ??= Date.now()) < Date.now() - SEAT_IDLE_MS) {
        await this.#detach(running, seat);
        await this.#remove(`${seatsPath(running.id)}/${name}`);
      }
    }
  }

  /** Take the seat `name`: an address in the game, its `out` to write and its `in` to read, once both streams are there. */
  async #attach(running: Running, name: string): Promise<Seat | undefined> {
    const vfs = this.cmd.sys.vfs;
    const [input, output] = await Promise.all([seatIn(running.id, name), seatOut(running.id, name)].map((path) => vfs.get(this.cmd.access, path).catch(() => undefined)));
    if (input?.type !== 'stream' || output?.type !== 'stream') return undefined;
    const out = await vfs.open(this.cmd.access, seatOut(running.id, name), { mode: 'w' }).catch(() => undefined);
    if (!out || !isStreamWriter(out)) {
      await out?.close();
      return undefined;
    }
    const seat: Seat = { name, ip: addressNumber(playerAddress(running.nextSeat++)), out, stop: new AbortController() };
    running.seats.set(name, seat);
    running.byIp.set(seat.ip, seat);
    void this.#read(running, seat);
    await this.#log(`${running.id}: ${name} sits at ${addressText(seat.ip)}`);
    return seat;
  }

  /** Pass what the seat's player writes to the worker, opening `in` again each time a writer of it is gone, until the seat is taken away. */
  async #read(running: Running, seat: Seat): Promise<void> {
    const vfs = this.cmd.sys.vfs;
    while (!seat.stop.signal.aborted) {
      const input = await vfs.open(this.cmd.access, seatIn(running.id, seat.name), { mode: 'r' }).catch(() => undefined);
      if (!input) break;
      try {
        for (;;) {
          const bytes = await input.read(CHUNK, seat.stop.signal);
          if (bytes.length === 0) break;
          running.worker.postMessage({ type: 'chunk', ip: seat.ip, bytes } satisfies ToWorker);
        }
      } catch {
        // Taken away while waiting.
      } finally {
        await input.close().catch(() => undefined);
      }
      running.worker.postMessage({ type: 'gone', ip: seat.ip } satisfies ToWorker);
    }
  }

  async #detach(running: Running, seat: Seat): Promise<void> {
    seat.stop.abort();
    running.seats.delete(seat.name);
    running.byIp.delete(seat.ip);
    await seat.out.close().catch(() => undefined);
    await this.#log(`${running.id}: ${seat.name} left`);
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

  async #end(running: Running): Promise<void> {
    this.#games.delete(running.id);
    running.worker.terminate();
    for (const seat of [...running.seats.values()]) await this.#detach(running, seat);
  }

  async #remove(path: string): Promise<void> {
    const result = await this.cmd.execute(`rm -r ${shq(path)}`);
    if (result.code !== 0 && await this.cmd.sys.vfs.exists(this.cmd.access, path)) await this.#log(`${path} not removed: ${result.stderr.trim()}`);
  }
}
