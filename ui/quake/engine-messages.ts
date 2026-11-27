/**
 * What the page (`worker-game.ts`) and the module's engine worker (`engine-worker.ts`) tell each
 * other, for Quake's, Quake II's and Quake 3's engines alike.
 */
import type { EngineName } from '../../lib/api.ts';

/** A file the engine is given whole: its path in the engine's file system, and its bytes. */
export type WholeFile = { path: string; data: Uint8Array<ArrayBuffer> };

/** A file the engine reads from EiN as it asks: its path in the engine's file system, its URL and its size. */
export type LazyFile = { path: string; url: string; size: number };

/** A datagram the page hands the worker: from whom (`ip`, `port`), the game's port it is for (`to`), and its bytes. */
export type Datagram = { ip: number; port: number; to: number; data: Uint8Array };

/** A file of the player's the game wrote, by its path in its folder. */
export type WrittenFile = { name: string; data: Uint8Array<ArrayBuffer> };

/**
 * Start the game: which engine plays it, the engine's glue and wasm by their URLs, its paks, read as
 * the engine asks, and the files it is given whole (the player's kept ones among them), the folder
 * the files it writes are in, its command line and, for Quake's and Quake II's, the commands it
 * runs after its configuration and, for Quake's, its heap's megabytes; the size Quake 3 draws at
 * with r_mode -2, the page's sample rate when it has sound, whether the game has music the page
 * plays, and whether it plays online, through the page's network.
 */
export type StartMessage = {
  type: 'start';
  family: EngineName;
  glue: string;
  wasm: string;
  lazy: LazyFile[];
  files: WholeFile[];
  writes: string;
  args: string[];
  commands?: string;
  heap?: number;
  display: { width: number; height: number };
  sampleRate?: number;
  music: boolean;
  online: boolean;
};

/** What the page tells the worker. */
export type ToWorker =
  | StartMessage
  | { type: 'tick'; datagrams: Datagram[] }
  | { type: 'key'; pressed: boolean; key: number }
  | { type: 'char'; character: number }
  | { type: 'mouse'; dx: number; dy: number }
  | { type: 'keep' }
  | { type: 'disconnect' }
  | { type: 'fullscreen'; on: boolean }
  | { type: 'stop' };

/** The game asks the page's music player to play a track, to stop, to pause or go on, or to change its volume. */
export type MusicCall =
  | { call: 'play'; track: number; looping: boolean }
  | { call: 'stop' }
  | { call: 'pause'; paused: boolean }
  | { call: 'volume'; level: number };

/**
 * What the worker tells the page: it started; a line the game printed; files of the player's it
 * wrote, a save slot's `folder` with all of them or one file; a port it opened and a datagram it
 * sends; music; a tick's outcome, what was drawn when a frame was, the sound mixed since the last
 * one (interleaved 16-bit stereo), and whether a menu or the console is up and the frame
 * fullscreen; or that the game ended, on Quit or with an error.
 */
export type FromWorker =
  | { type: 'started' }
  | { type: 'log'; line: string }
  | { type: 'wrote'; files: WrittenFile[]; folder?: string }
  | { type: 'net-open'; port: number }
  | { type: 'net-send'; from: number; ip: number; to: number; data: Uint8Array }
  | ({ type: 'music' } & MusicCall)
  | { type: 'frame'; frame?: ImageBitmap; sound?: Int16Array<ArrayBuffer>; menu: boolean; fullscreen: boolean }
  | { type: 'ended'; quit?: boolean; error?: string };
