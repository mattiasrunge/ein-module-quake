import { fileUrl } from '@ein/ui/lib';
import type { Kept } from './saves.ts';
import type { Sound } from './sound.ts';
import { type Game, GAMES } from './games.ts';

/** Where the module's built engine sits in EiN's tree. */
const ASSETS = '/usr/modules/quake/assets';

/** The megabytes Quake's own allocator gets: what LibreQuake's larger maps need, with room to spare. */
const HEAP = 64;

/** What `assets/quake.js` (Emscripten's glue, `engine/Containerfile`) gives back once the wasm runs. */
type QuakeModule = {
  FS: {
    writeFile(path: string, data: Uint8Array | string): void;
    readFile(path: string, options: { encoding: 'utf8' }): string;
    mkdir(path: string): void;
  };
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  HEAPU32: Uint32Array;
  stringToNewUTF8(text: string): number;
  _malloc(bytes: number): number;
  _ein_start(argc: number, argv: number, heap: number, commands: number): void;
  _ein_tick(): void;
  _ein_key(pressed: number, key: number): void;
  _ein_mouse(dx: number, dy: number): void;
  _ein_write_config(): void;
  _ein_screen(): number;
  _ein_width(): number;
  _ein_height(): number;
  _ein_frames(): number;
  _ein_audio_rate(rate: number): void;
  _ein_audio_render(buffer: number, frames: number): void;
};

/** A running game: tick it, read its frame, hand it keys and the mouse. */
export type Engine = {
  game: string;
  width: number;
  height: number;
  /**
   * Run the game for the time since the last tick; throws when the game ends: what `quitted`
   * recognises when the player chose Quit, anything else when it failed (Quake's `Sys_Error`).
   */
  tick(): void;
  /** How many frames the game has drawn: a new number means a new frame to copy. */
  frames(): number;
  /** Copy the current frame into `image`, which is `width` by `height`. */
  draw(image: ImageData): void;
  key(pressed: boolean, key: number): void;
  mouse(dx: number, dy: number): void;
  /** Write config.cfg, so the player's settings are kept when the page stops the game. */
  writeConfig(): void;
};

/** Whether `error`, thrown by `tick`, is the game ending on Quit: Emscripten's `ExitStatus` for exit(0). */
export function quitted(error: unknown): boolean {
  const exit = error as { name?: string; status?: number } | null;
  return exit?.name === 'ExitStatus' && exit.status === 0;
}

/**
 * What a player without a config.cfg of their own starts with, after Quake's default.cfg: WASD
 * beside the arrows, as players have moved since.
 */
const FIRST_BINDINGS = ['bind w +forward', 'bind s +back', 'bind a +moveleft', 'bind d +moveright'];

/** Fetch a file as bytes; `/file/` needs the session's cookie, which a same-origin fetch sends. */
async function fetchFile(path: string): Promise<Uint8Array> {
  const response = await fetch(fileUrl(path));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Load the engine and `game`'s paks and start the game. `log` gets what Quake prints, line by line,
 * and `sound` the game's sound effects and music; without it the game is silent. `kept` are the
 * player's saves and config.cfg of `game`, which Quake's Load menu lists and its start-up reads, and
 * `onKeep` hears each of them Quake writes.
 *
 * The glue is imported from a URL held in a variable, so core's bundler leaves it alone and the
 * browser loads it at runtime. The wasm is fetched here and handed over as bytes, so how `/file/`
 * labels a `.wasm` does not matter.
 */
export async function startEngine({ game, sound, log, kept = [], onKeep }: {
  game: Game;
  sound?: Sound;
  log: (line: string) => void;
  kept?: Kept[];
  onKeep?: (file: Kept) => void;
}): Promise<Engine> {
  const glueUrl = fileUrl(`${ASSETS}/quake.js`);
  const [glue, wasmBinary, paks] = await Promise.all([
    import(glueUrl) as Promise<{ default: (options: object) => Promise<QuakeModule> }>,
    fetchFile(`${ASSETS}/quake.wasm`),
    Promise.all(game.paks.map((pak) => fetchFile(`${GAMES}/${game.name}/${pak}`))),
  ]);

  const einMusic = sound?.music(game.music);
  // Called by `ein_wrote` once Quake has written the file; `quake` is set by then.
  const einWrote = (path: string) => {
    const name = path.split('/').at(-1) ?? path;
    onKeep?.({ name, text: quake.FS.readFile(path, { encoding: 'utf8' }) });
  };
  const quake = await glue.default({ wasmBinary, print: log, printErr: log, einMusic, einWrote });

  // The game's folder is /id1, as Quake's own is, whatever it is called here: its paks under the
  // names Quake loads, then the player's saves and config.cfg beside them.
  quake.FS.mkdir('/id1');
  paks.forEach((bytes, i) => quake.FS.writeFile(`/id1/pak${i}.pak`, bytes));
  for (const file of kept) quake.FS.writeFile(`/id1/${file.name}`, file.text);

  const args = ['quake', ...(sound ? [] : ['-nosound'])];
  const argv = quake._malloc(args.length * 4);
  args.forEach((arg, i) => {
    quake.HEAPU32[(argv >> 2) + i] = quake.stringToNewUTF8(arg);
  });
  // Mouse look, as players have played since; and the first bindings for a player who has none.
  const commands = ['+mlook', ...(kept.some((file) => file.name === 'config.cfg') ? [] : FIRST_BINDINGS)];
  if (sound) quake._ein_audio_rate(sound.context.sampleRate);
  quake._ein_start(args.length, argv, HEAP, quake.stringToNewUTF8(commands.join('\n') + '\n'));

  // The effects: interleaved 16-bit stereo from Quake's mixer, into a buffer kept for them.
  let mixFrames = 0;
  let mixBuffer = 0;
  sound?.effects((left, right) => {
    if (left.length > mixFrames) {
      mixFrames = left.length;
      mixBuffer = quake._malloc(mixFrames * 4);
    }
    quake._ein_audio_render(mixBuffer, left.length);
    // HEAP16 is looked up each time: memory growth replaces it.
    const samples = quake.HEAP16.subarray(mixBuffer >> 1, (mixBuffer >> 1) + left.length * 2);
    for (let i = 0; i < left.length; i++) {
      left[i] = samples[i * 2] / 32768;
      right[i] = samples[i * 2 + 1] / 32768;
    }
  });

  const width = quake._ein_width();
  const height = quake._ein_height();
  return {
    game: game.name,
    width,
    height,
    tick: () => quake._ein_tick(),
    frames: () => quake._ein_frames(),
    draw(image) {
      // The engine keeps the frame as R, G, B, A bytes already. The heap is looked up each time:
      // memory growth replaces it.
      const at = quake._ein_screen();
      image.data.set(quake.HEAPU8.subarray(at, at + width * height * 4));
    },
    key: (pressed, key) => quake._ein_key(pressed ? 1 : 0, key),
    mouse: (dx, dy) => quake._ein_mouse(dx, dy),
    writeConfig: () => quake._ein_write_config(),
  };
}
