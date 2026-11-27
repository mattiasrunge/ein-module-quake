/**
 * The module's engine worker, run by the games module's kit (`serveEngine`): Quake's, Quake II's or
 * Quake 3's engine, Emscripten's builds in `assets/`, with the game's paks read from EiN a piece at
 * a time as it asks for them. Quake 3 draws on the worker's canvas with WebGL; Quake and Quake II
 * draw on it with WebGL too, or leave a frame of R, G, B, A bytes in their memory, as the player
 * chooses their renderer (`_ein_gl` says which drew the last frame), put on a canvas of its own.
 */
import { argv, type EmscriptenModule, type Engine, FrameCanvas, heapSound, keptPath, serveEngine, startEmscripten } from '@games/engine';
import type { QuakeStart } from './start.ts';

/** The widest frame Quake II and Quake 3 draw at the screen's size, whatever the screen: wider takes more of the GPU than it shows. */
const MAX_WIDTH = 1920;

/**
 * What the engines' platform layers export (`engine/`), beside Emscripten's own: `_ein_start` takes
 * the command line, then Quake's heap's megabytes and its commands, Quake II's commands, or nothing
 * more; Quake II and Quake 3 take characters; Quake 3 draws with WebGL, Quake and Quake II either
 * that or leave their frame in `_ein_screen`, as `_ein_gl` says of their last frame.
 */
type QuakeModule = EmscriptenModule & {
  _ein_start(argc: number, argv: number, ...rest: number[]): void;
  _ein_tick(): void;
  _ein_key(pressed: number, key: number): void;
  _ein_char?(character: number): void;
  _ein_mouse(dx: number, dy: number): void;
  _ein_write_config(): void;
  _ein_disconnect(): void;
  _ein_menu(): number;
  _ein_fullscreen(): number;
  _ein_set_fullscreen(on: number): void;
  _ein_frames(): number;
  _ein_gl?(): number;
  _ein_screen?(): number;
  _ein_width?(): number;
  _ein_height?(): number;
  _ein_audio_rate(rate: number): void;
  _ein_audio_render(at: number, frames: number): void;
};

let quake: QuakeModule;
let frames: FrameCanvas;
let webgl = false;
/** Quake's and Quake II's software renderers' frames, beside their WebGL ones on `frames`: a canvas has one kind of context. */
let soft: FrameCanvas | undefined;
let drawn = 0;
let sound: ((count: number) => Int16Array<ArrayBuffer>) | undefined;

/**
 * The size Quake II and Quake 3 draw at with r_mode -2 (`Module.einDisplay` in their `glimp_ein.c`): the screen's, in
 * its pixels, as the game is shown fullscreen, but no wider than `MAX_WIDTH`.
 */
function display(screen: { width: number; height: number }): { width: number; height: number } {
  const width = Math.min(MAX_WIDTH, screen.width);
  return { width, height: Math.round(width * screen.height / screen.width) };
}

const engine: Engine<QuakeStart> = {
  async boot(boot) {
    const { family, build, writes, args, commands, heap } = boot.payload;
    const size = display(boot.screen);
    webgl = family === 'quake3';
    frames = new FrameCanvas(size.width, size.height);
    if (!webgl) soft = new FrameCanvas(size.width, size.height);
    quake = await startEmscripten<QuakeModule>(boot, build, {
      canvas: frames.canvas,
      // A path the game wrote is its own folder first (`./id1/s0.sav`, `./baseq2/save/s1`,
      // `baseoa/q3config.cfg`), which is `writes` in the engine's file system.
      written: (path) => ({ path: `${writes}/${keptPath(path, 1)}`, name: keptPath(path, 1) }),
      module: { einDisplay: () => size },
    });
    if (boot.sampleRate) {
      quake._ein_audio_rate(boot.sampleRate);
      sound = heapSound(quake, (at, count) => quake._ein_audio_render(at, count));
    }
    const line = argv(quake, args);
    const text = quake.stringToNewUTF8(commands ?? '');
    if (family === 'quake') quake._ein_start(args.length, line, heap ?? 0, text);
    else if (family === 'quake2') quake._ein_start(args.length, line, text);
    else quake._ein_start(args.length, line);
  },
  tick: () => quake._ein_tick(),
  frame() {
    if (quake._ein_frames() === drawn) return undefined;
    drawn = quake._ein_frames();
    if (webgl || quake._ein_gl?.()) return frames.take();
    return soft!.rgba(new Uint8Array(quake.HEAPU8.buffer, quake._ein_screen!()), quake._ein_width!(), quake._ein_height!());
  },
  sound: (count) => sound?.(count),
  key: (pressed, key) => quake._ein_key(pressed ? 1 : 0, key),
  char: (character) => quake._ein_char?.(character),
  mouse: (dx, dy) => quake._ein_mouse(dx, dy),
  menu: () => quake._ein_menu() !== 0,
  fullscreen: () => quake._ein_fullscreen() !== 0,
  setFullscreen: (on) => quake._ein_set_fullscreen(on ? 1 : 0),
  // Quake 3 writes its own settings whenever they change; this writes Quake's and Quake II's too.
  keep: () => quake._ein_write_config(),
  disconnect: () => quake._ein_disconnect(),
};

serveEngine(engine);
