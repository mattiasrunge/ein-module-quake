/**
 * The engine the quake-server service runs hosted games with (`GameServers`): each game is its
 * engine's dedicated server, in a worker of its own (`server-worker.ts`), so a slow frame never
 * holds up EiN. The service hands each player's frames to the worker through memory both share (a
 * `Ring`), which the server reads whenever it reads, and passes on each frame the worker sends.
 */
import type { Command } from '@ein/client';
import type { ServerInfo } from '@games/api';
import type { HostedGame, ServerEngine, ServerIo } from '@games/host';
import { FRAME_HEADER, Ring } from '@games/net';
import type { EngineName } from './api.ts';
import { gameFiles } from './catalog.ts';
import { gamedirOf, GAMES } from './games.ts';
import { openReader, packPak, PAK_HEADER_SIZE, pakDirectory, pakEntries, readWhole } from './paks.ts';
import { trimPk3 } from './pk3.ts';
import type { FromWorker, StartServer, ToWorker } from './server-worker.ts';

/** Where the module is in EiN's tree: the servers' engines in `assets/`, the worker in `lib/`. */
const MODULE = '/usr/modules/quake';

/**
 * The network a server plays on and the memory it reads its players' frames from (`@games/net`),
 * by its path in EiN's tree: the worker imports it from its text, as it imports nothing else.
 */
const NET = '/usr/modules/games/lib/net.ts';

/**
 * What each engine's dedicated server takes: its game folder for the game `info` hosts, its build in
 * `assets/`, the files it never reads (sounds, pictures, skins), which are left out of the paks and
 * the files it is given when it says, or for Quake 3 the only files it reads, its modes, and its
 * command line for a game.
 */
type ServerSpec = {
  folder(info: ServerInfo): string;
  build: string;
  unread?: RegExp;
  reads?: RegExp;
  /** Paks of the module's own the game is played with as well, by the name they load under and their path in EiN's tree. */
  extra?(info: ServerInfo): { name: string; path: string }[];
  modes: string[];
  args(info: ServerInfo): string[];
};

/** Where Quake 3's server has its game's folder (`fs_basepath`), and its own files (`fs_homepath`). */
const QUAKE3_BASE = '/q3';
const QUAKE3_HOME = '/home';

/**
 * What a server is called in the games' own server lists, beside its map: the account that started
 * it, one word, which each engine's command line keeps whole (Quake's splits a word at a quote).
 */
const hostname = (info: ServerInfo): string => info.startedBy;

const SPECS: Record<EngineName, ServerSpec> = {
  quake2: {
    folder: () => '/baseq2',
    build: 'quake2-server',
    // Quake II's server reads its maps and its configuration; models, sounds and pictures it names only.
    unread: /\.(wav|pcx|wal|md2|sp2|cin|tga|jpg|png|ogg|mp3|dm2)$/,
    // The mode is the cvar that sets it: deathmatch or coop.
    modes: ['deathmatch', 'coop'],
    args: (
      info,
    ) => ['quake2', '+set', 'dedicated', '1', '+set', 'hostname', hostname(info), '+set', info.mode, '1', '+set', 'maxclients', String(info.maxPlayers), '+map', info.map],
  },
  quake: {
    folder: () => '/id1',
    build: 'quake-server',
    // Quake's paks are given whole: one with fewer files than id's is a modified game, which the
    // shareware episode refuses to run.
    // -dedicated sets deathmatch when it has room for more than one; a cooperative game says otherwise.
    modes: ['deathmatch', 'coop'],
    args: (
      info,
    ) => ['quake', '-dedicated', String(info.maxPlayers), '+hostname', hostname(info), ...(info.mode === 'coop' ? ['+deathmatch', '0', '+coop', '1'] : []), '+map', info.map],
  },
  quake3: {
    folder: (info) => `${QUAKE3_BASE}/${gamedirOf(info.game, info.title)}`,
    build: 'quake3-server',
    // Quake 3's server reads its arenas and their bots' routes, its game code, its scripts and bots,
    // and its configuration; textures, models and sounds are the players'. Its pk3s are not its
    // players' then, so it asks for none of them (sv_pure 0) and each player plays with their own.
    reads: /^(maps\/[^/]+\.(bsp|aas)|vm\/qagame\.qvm|scripts\/.*|botfiles\/.*|[^/]+\.cfg)$/,
    // id's demo is played with ioquake3's own game code, whose name sorts after the demo's pk3, as
    // the players' pages play it (`ui/quake/quake3.ts`).
    extra: (info) => gamedirOf(info.game, info.title) === 'demoq3' ? [{ name: 'zz-ein-game.pk3', path: `${MODULE}/assets/quake3-game.pk3` }] : [],
    // Quake 3 has no cooperative game: a deathmatch is its free for all (g_gametype 0). Bots join on
    // the console, as `addbot`.
    modes: ['deathmatch'],
    args: (info) => [
      'quake3',
      '+set',
      'dedicated',
      '1',
      '+set',
      'fs_basepath',
      QUAKE3_BASE,
      '+set',
      'fs_homepath',
      QUAKE3_HOME,
      '+set',
      'com_basegame',
      gamedirOf(info.game, info.title),
      '+set',
      'sv_pure',
      '0',
      '+set',
      'g_gametype',
      '0',
      '+set',
      'sv_maxclients',
      String(info.maxPlayers),
      '+set',
      'sv_hostname',
      hostname(info),
      '+map',
      info.map,
    ],
  },
};

/** The engine that runs `cmd`'s hosted games, Quake's and Quake II's, each a dedicated server in a worker. */
export function serverEngine(cmd: Command): ServerEngine {
  return { start: (info, io) => start(cmd, info, io) };
}

/** Start the game `info` asks for: its paks and files but those its server never reads, and the server's build, handed to a new worker. */
async function start(cmd: Command, info: ServerInfo, io: ServerIo): Promise<HostedGame> {
  const spec = SPECS[info.family as EngineName];
  if (!spec) throw new Error(`${info.title} is played by none of Quake's, Quake II's and Quake 3's engines`);
  if (!spec.modes.includes(info.mode)) throw new Error(`${info.title} is hosted in ${spec.modes.join(' or ')}, not ${info.mode}`);
  const urls: string[] = [];
  const blob = async (path: string, type: string) => {
    const url = URL.createObjectURL(new Blob([await readWhole(cmd, path) as Uint8Array<ArrayBuffer>], { type }));
    urls.push(url);
    return url;
  };
  try {
    const [{ paks, files }, wasm, glue, net, code] = await Promise.all([
      gameData(cmd, info, spec),
      readWhole(cmd, `${MODULE}/assets/${spec.build}.wasm`),
      blob(`${MODULE}/assets/${spec.build}.js`, 'text/javascript'),
      blob(NET, 'application/typescript'),
      blob(`${MODULE}/lib/server-worker.ts`, 'application/typescript'),
    ]);
    const ring = new Ring();
    const worker = new Worker(code, { type: 'module' });
    const started = Promise.withResolvers<void>();
    let running = false;
    const ended = (error?: string) => {
      if (!running) started.reject(new Error(error ?? 'the server quit as it started'));
      else io.ended(error);
    };
    worker.onmessage = ({ data: message }: MessageEvent<FromWorker>) => {
      switch (message.type) {
        case 'send':
          io.send(message.ip, message.framed);
          break;
        case 'log':
          io.log(message.line);
          break;
        case 'started':
          running = true;
          started.resolve();
          break;
        case 'status': {
          const { map, players } = JSON.parse(message.status) as { map: string; players: { name: string; frags: number; ping: number; address: string }[] };
          io.status(map, players);
          break;
        }
        case 'ended':
          worker.terminate();
          ended(message.error);
          break;
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      ended(event.message);
    };
    const message: StartServer = { type: 'start', glue, net, wasm, folder: spec.folder(info), paks, files, args: spec.args(info), ring: ring.buffer };
    worker.postMessage(message satisfies ToWorker, [wasm.buffer as ArrayBuffer, ...[...paks, ...files].map((file) => file.data.buffer as ArrayBuffer)]);
    try {
      await started.promise;
    } catch (error) {
      worker.terminate();
      throw error;
    }
    return {
      // A server too far behind to take more drops what does not fit, as the network would.
      deliver: (ip, framed) => void (framed.length >= FRAME_HEADER && ring.write(ip, framed)),
      stop: () => worker.terminate(),
    };
  } finally {
    // The worker has imported them by the time it says it started, or failed.
    urls.forEach((url) => URL.revokeObjectURL(url));
  }
}

/**
 * The paks of the game in the folder `game` under the names its server loads them by: Quake's and
 * Quake II's as `pak<N>.pak`, each without its files `spec.unread` matches, or whole without it;
 * Quake 3's pk3s under their own names, each with only the files `spec.reads` matches, and the
 * module's own `spec.extra` gives for the game. And the files beside them the server reads, by
 * their paths in the folder.
 */
async function gameData(cmd: Command, info: ServerInfo, { unread, reads, extra }: ServerSpec): Promise<{ paks: StartServer['paks']; files: StartServer['files'] }> {
  const folder = `${GAMES}/${info.game}`;
  const found = await gameFiles(cmd, folder);
  if (found.paks.length === 0) throw new Error(`${info.game} has no paks`);
  const skipped = (name: string) => reads ? !reads.test(name.toLowerCase()) : !!unread?.test(name.toLowerCase());
  const paks: StartServer['paks'] = [];
  for (const [i, pak] of found.paks.entries()) {
    if (reads) {
      paks.push({ name: pak, data: await trimPk3(cmd, `${folder}/${pak}`, (name) => reads.test(name)) });
      continue;
    }
    if (!unread) {
      paks.push({ name: `pak${i}.pak`, data: await readWhole(cmd, `${folder}/${pak}`) });
      continue;
    }
    const reader = await openReader(cmd, `${folder}/${pak}`);
    try {
      const directory = pakDirectory(await reader.read(0, PAK_HEADER_SIZE));
      if (!directory) throw new Error(`${pak} is not a pak`);
      const files = [];
      for (const entry of pakEntries(await reader.read(directory.offset, directory.length)).values()) {
        if (!unread.test(entry.name.toLowerCase())) files.push({ name: entry.name, data: await reader.read(entry.at, entry.size) });
      }
      paks.push({ name: `pak${i}.pak`, data: packPak(files) });
    } finally {
      await reader.close();
    }
  }
  for (const pak of extra?.(info) ?? []) paks.push({ name: pak.name, data: await readWhole(cmd, pak.path) });
  const read = found.files.filter((name) => !skipped(name));
  const files = await Promise.all(read.map(async (name) => ({ name, data: await readWhole(cmd, `${folder}/${name}`) })));
  return { paks, files };
}
