/**
 * What the page (`quake3.ts`) and the Quake 3 engine's worker (`quake3-worker.ts`) tell each other.
 */

/** A file the engine is given whole: its path in its folder, and its bytes. */
export type WholeFile = { name: string; data: Uint8Array<ArrayBuffer> };

/** A datagram the page hands the worker: from whom (`ip`, `port`), the game's port it is for (`to`), and its bytes. */
export type Datagram = { ip: number; port: number; to: number; data: Uint8Array };

/**
 * Start the game: the engine's glue and wasm by their URLs, the game's folder and the home folder in
 * the engine's file system, its pk3s by their names, URLs and sizes, which the worker reads as the
 * engine asks, the files it is given whole in the game's folder and in the home folder (the player's
 * kept files, by their paths there), its command line, the size it draws at with r_mode -2, the
 * page's sample rate when it has sound, and whether it plays online, through the page's network.
 */
export type StartMessage = {
  type: 'start';
  glue: string;
  wasm: string;
  folder: string;
  home: string;
  pk3s: { name: string; url: string; size: number }[];
  files: WholeFile[];
  kept: WholeFile[];
  args: string[];
  display: { width: number; height: number };
  sampleRate?: number;
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

/**
 * What the worker tells the page: it started; a line the game printed; a file of the player's it
 * wrote, by its path in the game's folder of the home folder; a port it opened and a datagram it
 * sends; a tick's outcome, what was drawn when a frame was, the sound mixed since the last one
 * (interleaved 16-bit stereo), and whether a menu or the console is up and the frame fullscreen; or
 * that the game ended, on Quit or with an error.
 */
export type FromWorker =
  | { type: 'started' }
  | { type: 'log'; line: string }
  | { type: 'wrote'; name: string; data: Uint8Array<ArrayBuffer> }
  | { type: 'net-open'; port: number }
  | { type: 'net-send'; from: number; ip: number; to: number; data: Uint8Array }
  | { type: 'frame'; frame?: ImageBitmap; sound?: Int16Array<ArrayBuffer>; menu: boolean; fullscreen: boolean }
  | { type: 'ended'; quit?: boolean; error?: string };
