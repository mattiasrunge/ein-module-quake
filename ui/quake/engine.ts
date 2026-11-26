import { fileUrl } from '@ein/ui/lib';
import type { EngineName } from '../../lib/api.ts';
import type { Network } from '../../lib/net.ts';
import type { Kept, Written } from './saves.ts';
import type { Sound } from './sound.ts';
import { type Game, GAMES } from './games.ts';

/** Where the module's built engines sit in EiN's tree. */
const ASSETS = '/usr/modules/quake/assets';

/** The megabytes Quake's own allocator gets: what LibreQuake's larger maps need, with room to spare. */
const HEAP = 64;

/**
 * What an engine's glue (`assets/quake.js`, `assets/quake2.js`: Emscripten's, `engine/Containerfile`
 * and `engine/quake2/Containerfile`) gives back once the wasm runs. The two engines export the same
 * functions, but for `_ein_start`.
 */
type EngineModule = {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array<ArrayBuffer>;
    readdir(path: string): string[];
    mkdirTree(path: string): void;
    isDir(mode: number): boolean;
    stat(path: string): { mode: number };
  };
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAPU32: Uint32Array;
  stringToNewUTF8(text: string): number;
  _malloc(bytes: number): number;
  /** Quake's takes its heap's megabytes between the command line and the commands; Quake 2's has none. */
  _ein_start(argc: number, argv: number, heapOrCommands: number, commands?: number): void;
  _ein_tick(): void;
  _ein_key(pressed: number, key: number): void;
  _ein_mouse(dx: number, dy: number): void;
  _ein_write_config(): void;
  _ein_disconnect(): void;
  _ein_screen(): number;
  _ein_width(): number;
  _ein_height(): number;
  _ein_frames(): number;
  _ein_audio_rate(rate: number): void;
  _ein_audio_render(buffer: number, frames: number): void;
};

/**
 * What differs between the engines: the files built, the game's folder in the engine's file system,
 * its command line, the commands it runs once its own configuration has, and how it starts.
 */
type EngineSpec = {
  name: string;
  folder: string;
  /** The command line, without or with sound. */
  args(sound: boolean): string[];
  /** The commands after the game's configuration: `first` when the player has no config.cfg of their own. */
  commands(first: boolean): string[];
  start(engine: EngineModule, argc: number, argv: number, commands: number): void;
  /** The name a player has in their config.cfg, `undefined` when it is the engine's own first one or none. */
  playerName(config: string): string | undefined;
};

/** WASD beside the arrows, as players have moved since: what a player without a config.cfg starts with. */
const WASD = ['bind w +forward', 'bind s +back', 'bind a +moveleft', 'bind d +moveright'];

const ENGINES: Record<EngineName, EngineSpec> = {
  quake: {
    name: 'quake',
    folder: '/id1',
    args: (sound) => ['quake', ...(sound ? [] : ['-nosound'])],
    // Mouse look, as players have played since, which Quake does not keep in config.cfg.
    commands: (first) => ['+mlook', ...(first ? WASD : [])],
    start: (engine, argc, argv, commands) => engine._ein_start(argc, argv, HEAP, commands),
    // Quake keeps the name as _cl_name; "player" is what everyone starts with.
    playerName: (config) => /^_cl_name "(.*)"/m.exec(config)?.[1].replace(/^player$/, '') || undefined,
  },
  quake2: {
    name: 'quake2',
    folder: '/baseq2',
    // 640 by 480 (sw_mode 3), as Quake's frame, unless the player's config.cfg has another mode; and
    // without the frame rate quake2generic draws in the corner (cg_drawfps, which no config.cfg keeps).
    args: (sound) => ['quake2', '+set', 'sw_mode', '3', '+set', 'cg_drawfps', '0', ...(sound ? [] : ['+set', 's_initsound', '0'])],
    // Free look is Quake 2's mouse look, and config.cfg keeps it.
    commands: (first) => first ? [...WASD, 'set freelook 1'] : [],
    start: (engine, argc, argv, commands) => engine._ein_start(argc, argv, commands),
    // "unnamed" is what everyone starts with.
    playerName: (config) => /^set name "(.*)"/m.exec(config)?.[1].replace(/^unnamed$/, '') || undefined,
  },
};

/** A running game: tick it, read its frame, hand it keys and the mouse. */
export type Engine = {
  game: string;
  /** The frame's size, which a Quake 2 player changes with the video mode. */
  width(): number;
  height(): number;
  /**
   * Run the game for the time since the last tick; throws when the game ends: what `quitted`
   * recognises when the player chose Quit, anything else when it failed (`Sys_Error`).
   */
  tick(): void;
  /** How many frames the game has drawn: a new number means a new frame to copy. */
  frames(): number;
  /** Copy the current frame into `image`, which is `width()` by `height()`. */
  draw(image: ImageData): void;
  key(pressed: boolean, key: number): void;
  mouse(dx: number, dy: number): void;
  /** Write config.cfg, so the player's settings are kept when the page stops the game. */
  writeConfig(): void;
  /** Leave the server the game plays on, telling it so. */
  disconnect(): void;
};

/** A server to play on: the network to it, the address to connect to, and the name to play under when the player has none of their own. */
export type Online = { network: Network; address: string; name: string };

/** Whether `error`, thrown by `tick`, is the game ending on Quit: Emscripten's `ExitStatus` for exit(0). */
export function quitted(error: unknown): boolean {
  const exit = error as { name?: string; status?: number } | null;
  return exit?.name === 'ExitStatus' && exit.status === 0;
}

/** Fetch a file as bytes; `/file/` needs the session's cookie, which a same-origin fetch sends. */
async function fetchFile(path: string): Promise<Uint8Array> {
  const response = await fetch(fileUrl(path));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Load `game`'s engine and paks and start the game. `log` gets what the game prints, line by line,
 * and `sound` the game's sound effects and music; without it the game is silent. `kept` are the
 * player's saves and config.cfg of `game`, which the game's Load menu lists and its start-up reads,
 * and `onKeep` hears each save or config.cfg the game writes.
 *
 * With `online` the game connects to a server once it has started, through `online.network`.
 *
 * The glue is imported from a URL held in a variable, so core's bundler leaves it alone and the
 * browser loads it at runtime. The wasm is fetched here and instantiated from its bytes, so how
 * `/file/` labels a `.wasm` does not matter.
 */
export async function startEngine({ game, sound, log, kept = [], onKeep, online }: {
  game: Game;
  sound?: Sound;
  log: (line: string) => void;
  kept?: Kept[];
  onKeep?: (written: Written) => void;
  online?: Online;
}): Promise<Engine> {
  const spec = ENGINES[game.engine];
  const glueUrl = fileUrl(`${ASSETS}/${spec.name}.js`);
  const [glue, wasmBinary, paks, files] = await Promise.all([
    import(glueUrl) as Promise<{ default: (options: object) => Promise<EngineModule> }>,
    fetchFile(`${ASSETS}/${spec.name}.wasm`),
    Promise.all(game.paks.map((pak) => fetchFile(`${GAMES}/${game.name}/${pak}`))),
    Promise.all(game.files.map((file) => fetchFile(`${GAMES}/${game.name}/${file}`))),
  ]);

  const einMusic = sound?.music(game.music);
  // Called by `ein_wrote` once the game has written a file or a save slot's folder, at a path in its
  // folder, as the game names it (`./id1/s0.sav`, `./baseq2/save/s1`); `engine` is set by then.
  const einWrote = (path: string) => {
    const name = path.replace(/^\.?\/+/, '').replace(/^[^/]+\//, '');
    const at = `${spec.folder}/${name}`;
    if (!engine.FS.isDir(engine.FS.stat(at).mode)) {
      onKeep?.({ files: [{ name, data: engine.FS.readFile(at) }] });
      return;
    }
    const files = engine.FS.readdir(at).filter((file) => file !== '.' && file !== '..');
    onKeep?.({ folder: name, files: files.map((file) => ({ name: `${name}/${file}`, data: engine.FS.readFile(`${at}/${file}`) })) });
  };
  // The glue would fetch the wasm again beside itself unless it is handed the instance.
  const instantiateWasm = (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => {
    void WebAssembly.instantiate(wasmBinary as Uint8Array<ArrayBuffer>, imports).then(({ instance }) => receive(instance));
    return {};
  };
  const engine = await glue.default({ instantiateWasm, print: log, printErr: log, einMusic, einWrote, einNet: online?.network });

  // The game's folder is the engine's own, /id1 or /baseq2, whatever it is called here: its paks under
  // the names the engine loads, then the player's saves and config.cfg in it.
  engine.FS.mkdirTree(spec.folder);
  paks.forEach((bytes, i) => engine.FS.writeFile(`${spec.folder}/pak${i}.pak`, bytes));
  game.files.forEach((file, i) => {
    const at = `${spec.folder}/${file}`;
    engine.FS.mkdirTree(at.slice(0, at.lastIndexOf('/')));
    engine.FS.writeFile(at, files[i]);
  });
  for (const file of kept) {
    const at = `${spec.folder}/${file.name}`;
    engine.FS.mkdirTree(at.slice(0, at.lastIndexOf('/')));
    engine.FS.writeFile(at, file.data);
  }

  const args = spec.args(!!sound);
  const argv = engine._malloc(args.length * 4);
  args.forEach((arg, i) => {
    engine.HEAPU32[(argv >> 2) + i] = engine.stringToNewUTF8(arg);
  });
  const config = kept.find((file) => file.name === 'config.cfg');
  const commands = spec.commands(!config);
  if (online) {
    // Someone without a name of their own plays under their account's.
    if (!spec.playerName(config ? new TextDecoder().decode(config.data) : '')) commands.push(`name "${online.name.replace(/"/g, '')}"`);
    commands.push(`connect ${online.address}`);
  }
  if (sound) engine._ein_audio_rate(sound.context.sampleRate);
  spec.start(engine, args.length, argv, engine.stringToNewUTF8(commands.join('\n') + '\n'));

  // The effects: interleaved 16-bit stereo from the game's mixer, into a buffer kept for them.
  let mixFrames = 0;
  let mixBuffer = 0;
  sound?.effects((left, right) => {
    if (left.length > mixFrames) {
      mixFrames = left.length;
      mixBuffer = engine._malloc(mixFrames * 4);
    }
    engine._ein_audio_render(mixBuffer, left.length);
    // HEAP16 is looked up each time: memory growth replaces it.
    const samples = engine.HEAP16.subarray(mixBuffer >> 1, (mixBuffer >> 1) + left.length * 2);
    for (let i = 0; i < left.length; i++) {
      left[i] = samples[i * 2] / 32768;
      right[i] = samples[i * 2 + 1] / 32768;
    }
  });

  return {
    game: game.name,
    width: () => engine._ein_width(),
    height: () => engine._ein_height(),
    tick: () => engine._ein_tick(),
    frames: () => engine._ein_frames(),
    draw(image) {
      // The engine keeps the frame as R, G, B, A bytes already. The heap and the frame are looked up
      // each time: memory growth replaces the one, a new video mode the other.
      const at = engine._ein_screen();
      image.data.set(engine.HEAPU8.subarray(at, at + image.width * image.height * 4));
    },
    key: (pressed, key) => engine._ein_key(pressed ? 1 : 0, key),
    mouse: (dx, dy) => engine._ein_mouse(dx, dy),
    writeConfig: () => engine._ein_write_config(),
    disconnect: () => engine._ein_disconnect(),
  };
}
