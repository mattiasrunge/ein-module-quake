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
import { GAMES } from './games.ts';
import { openReader, packPak, PAK_HEADER_SIZE, pakDirectory, pakEntries, readWhole } from './paks.ts';
import type { FromWorker, StartServer, ToWorker } from './server-worker.ts';

/** Where the module is in EiN's tree: the servers' engines in `assets/`, the worker in `lib/`. */
const MODULE = '/usr/modules/quake';

/**
 * The network a server plays on and the memory it reads its players' frames from (`@games/net`),
 * by its path in EiN's tree: the worker imports it from its text, as it imports nothing else.
 */
const NET = '/usr/modules/games/lib/net.ts';

/**
 * What each engine's dedicated server takes: its game folder, its build in `assets/`, the files it
 * never reads (sounds, pictures, skins), which are left out of the paks and the files it is given
 * when it says, and its command line for a game.
 */
type ServerSpec = { folder: string; build: string; unread?: RegExp; args(info: ServerInfo): string[] };

const SPECS: Record<EngineName, ServerSpec> = {
  quake2: {
    folder: '/baseq2',
    build: 'quake2-server',
    // Quake II's server reads its maps and its configuration; models, sounds and pictures it names only.
    unread: /\.(wav|pcx|wal|md2|sp2|cin|tga|jpg|png|ogg|mp3|dm2)$/,
    // The mode is the cvar that sets it: deathmatch or coop.
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

/** The modes the servers are hosted in, by the cvar each sets. */
const MODES = ['deathmatch', 'coop'];

/** The engine that runs `cmd`'s hosted games, Quake's and Quake II's, each a dedicated server in a worker. */
export function serverEngine(cmd: Command): ServerEngine {
  return { start: (info, io) => start(cmd, info, io) };
}

/** Start the game `info` asks for: its paks and files but those its server never reads, and the server's build, handed to a new worker. */
async function start(cmd: Command, info: ServerInfo, io: ServerIo): Promise<HostedGame> {
  const spec = SPECS[info.family as EngineName];
  if (!spec) throw new Error(`${info.title} is played by neither Quake's engine nor Quake II's`);
  if (!MODES.includes(info.mode)) throw new Error(`a game is hosted in ${MODES.join(' or ')}, not ${info.mode}`);
  const urls: string[] = [];
  const blob = async (path: string, type: string) => {
    const url = URL.createObjectURL(new Blob([await readWhole(cmd, path) as Uint8Array<ArrayBuffer>], { type }));
    urls.push(url);
    return url;
  };
  try {
    const [{ paks, files }, wasm, glue, net, code] = await Promise.all([
      gameData(cmd, info.game, spec.unread),
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
    const message: StartServer = { type: 'start', glue, net, wasm, folder: spec.folder, paks, files, args: spec.args(info), ring: ring.buffer };
    worker.postMessage(message satisfies ToWorker, [wasm.buffer as ArrayBuffer, ...[...paks, ...files.map((file) => file.data)].map((bytes) => bytes.buffer as ArrayBuffer)]);
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
 * The paks of the game in the folder `game`, each without its files `unread` matches, or whole
 * without it; and the files beside them the server reads, by their paths in the folder.
 */
async function gameData(cmd: Command, game: string, unread?: RegExp): Promise<{ paks: Uint8Array[]; files: StartServer['files'] }> {
  const folder = `${GAMES}/${game}`;
  const found = await gameFiles(cmd, folder);
  if (found.paks.length === 0) throw new Error(`${game} has no paks`);
  const paks: Uint8Array[] = [];
  for (const pak of found.paks) {
    if (!unread) {
      paks.push(await readWhole(cmd, `${folder}/${pak}`));
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
      paks.push(packPak(files));
    } finally {
      await reader.close();
    }
  }
  const read = found.files.filter((name) => !unread?.test(name.toLowerCase()));
  const files = await Promise.all(read.map(async (name) => ({ name, data: await readWhole(cmd, `${folder}/${name}`) })));
  return { paks, files };
}
