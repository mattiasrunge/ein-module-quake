/// <reference lib="webworker" />
/**
 * The module's engine worker (`worker-game.ts` starts it): Quake's, Quake II's or Quake 3's engine,
 * Emscripten's builds in `assets/`, runs here rather than in the page, so it can read the game's
 * paks a piece at a time as it asks for them, with synchronous range requests, which only a worker
 * may make. A pak is fetched a megabyte at a time, each piece once, so only what the game reads is
 * downloaded and kept: its menus, and the levels played with what they show.
 *
 * The page starts it with the game's paks by their URLs and sizes and the files the engine is given
 * whole, then sends a `tick` each animation frame, with the datagrams that came for the game since;
 * the worker runs a frame and answers with what was drawn, as an ImageBitmap, the sound mixed for
 * the time since the last tick, and whether a menu or the console is up and the frame fullscreen.
 * Keys, characters and the mouse come as messages between the ticks, in order. Quake 3 draws on the
 * worker's canvas with WebGL; Quake and Quake II draw a frame of pixels, which the worker puts on a
 * canvas of its own.
 */
import type { Datagram, FromWorker, MusicCall, StartMessage, ToWorker } from './engine-messages.ts';

/** The bytes a pak is fetched in. */
const CHUNK = 1 << 20;

/** The most sound a tick mixes, in seconds: after a long pause the game goes on from now. */
const MAX_SOUND = 0.25;

/** A read of Emscripten's file system: into `buffer` at `offset`, `length` bytes from `position`; answers how many it read. */
type StreamRead = (stream: unknown, buffer: Int8Array, offset: number, length: number, position: number) => number;

/**
 * What an engine's glue (Emscripten's, the Containerfiles in `engine/`) gives back once the wasm
 * runs: what the three engines export alike, and what only some do. `_ein_start` takes the command
 * line, then Quake's heap's megabytes and its commands, Quake II's commands, or nothing more.
 */
type EngineModule = {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array<ArrayBuffer>;
    readdir(path: string): string[];
    mkdirTree(path: string): void;
    isDir(mode: number): boolean;
    stat(path: string): { mode: number };
    lookupPath(path: string): { node: { usedBytes: number; stream_ops: { read: StreamRead } } };
  };
  HEAPU8: Uint8Array<ArrayBuffer>;
  HEAP16: Int16Array;
  HEAPU32: Uint32Array;
  stringToNewUTF8(text: string): number;
  _malloc(bytes: number): number;
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
  _ein_screen?(): number;
  _ein_width?(): number;
  _ein_height?(): number;
  _ein_audio_rate(rate: number): void;
  _ein_audio_render(buffer: number, frames: number): void;
};

/** Emscripten's end of a program, which it throws: `status` 0 is Quit. */
type ExitStatus = { name: 'ExitStatus'; status: number };
const isExit = (error: unknown): error is ExitStatus => (error as ExitStatus | null)?.name === 'ExitStatus';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const tell = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

/** The running game: its engine, and where its frames come from, the WebGL canvas the engine draws on or a canvas the worker puts its pixels on. */
let engine: EngineModule | undefined;
let canvas: OffscreenCanvas;
let pixels: OffscreenCanvasRenderingContext2D | undefined;
let drawn = 0;
let rate = 0;
let soundAt = 0;
let soundBuffer = 0;
let soundFrames = 0;
/** The datagrams waiting for each port the game opened, as the page handed them over. */
const sockets = new Map<number, Datagram[]>();

/**
 * The file at `url`, `size` bytes, as a file at `path` of the engine's file system that is read from
 * the network: each read takes the megabytes it falls in, fetched once with a synchronous range
 * request and kept. A server that answers with the whole file gives it all at once.
 */
function lazyFile(fs: EngineModule['FS'], path: string, url: string, size: number) {
  const chunks = new Map<number, Uint8Array>();
  const chunk = (index: number): Uint8Array => {
    const kept = chunks.get(index);
    if (kept) return kept;
    const start = index * CHUNK;
    const request = new XMLHttpRequest();
    request.open('GET', url, false);
    request.responseType = 'arraybuffer';
    request.setRequestHeader('Range', `bytes=${start}-${Math.min(size, start + CHUNK) - 1}`);
    request.send();
    if (request.status === 200) {
      const whole = new Uint8Array(request.response);
      for (let at = 0; at < whole.length; at += CHUNK) chunks.set(at / CHUNK, whole.subarray(at, at + CHUNK));
      return chunks.get(index)!;
    }
    if (request.status !== 206) throw new Error(`${url}: ${request.status} ${request.statusText}`);
    const bytes = new Uint8Array(request.response);
    chunks.set(index, bytes);
    return bytes;
  };
  fs.mkdirTree(path.slice(0, path.lastIndexOf('/')));
  fs.writeFile(path, new Uint8Array(0));
  const node = fs.lookupPath(path).node;
  node.usedBytes = size;
  node.stream_ops = {
    ...node.stream_ops,
    read(_stream, buffer, offset, length, position) {
      const count = Math.max(0, Math.min(length, size - position));
      for (let done = 0; done < count;) {
        const at = position + done;
        const bytes = chunk(Math.floor(at / CHUNK));
        const from = at % CHUNK;
        const part = Math.min(count - done, bytes.length - from);
        buffer.set(bytes.subarray(from, from + part), offset + done);
        done += part;
      }
      return count;
    },
  };
}

/** The engine's network (`Module.einNet`, the engines' `net_ein.c`): the page carries the datagrams. */
const network = {
  open(port: number): number {
    if (!sockets.has(port)) sockets.set(port, []);
    tell({ type: 'net-open', port });
    return port;
  },
  send(from: number, ip: number, to: number, data: Uint8Array) {
    tell({ type: 'net-send', from, ip, to, data }, [data.buffer]);
  },
  recv: (port: number) => sockets.get(port)?.shift(),
};

/** The engine's music player (`Module.einMusic`, Quake's and Quake II's `cd_ein.c`): the page plays it. */
const music = {
  play: (track: number, looping: boolean) => playMusic({ call: 'play', track, looping }),
  stop: () => playMusic({ call: 'stop' }),
  pause: (paused: boolean) => playMusic({ call: 'pause', paused }),
  volume: (level: number) => playMusic({ call: 'volume', level }),
};
const playMusic = (call: MusicCall) => tell({ type: 'music', ...call });

/** The game ended: it quit, or `error` stopped it. */
function end(error: unknown) {
  engine = undefined;
  if (isExit(error) && error.status === 0) tell({ type: 'ended', quit: true });
  else tell({ type: 'ended', error: isExit(error) ? `the game exited with status ${error.status}` : String((error as Error | null)?.message ?? error) });
}

async function start(message: StartMessage) {
  const { family, glue, wasm, lazy, files, writes, args, commands, heap, display, sampleRate, online } = message;
  const [{ default: create }, wasmBytes] = await Promise.all([
    import(glue) as Promise<{ default: (options: object) => Promise<EngineModule> }>,
    fetch(wasm).then((response) => response.arrayBuffer()),
  ]);
  canvas = new OffscreenCanvas(display.width, display.height);
  if (family !== 'quake3') pixels = canvas.getContext('2d')!;
  const log = (line: string) => tell({ type: 'log', line });
  const instantiateWasm = (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => {
    WebAssembly.instantiate(wasmBytes, imports).then(({ instance }) => receive(instance), end);
    return {};
  };
  // Called by `ein_wrote` once the game has written a file or a save slot's folder, at its path as
  // the game names it, its own folder first (`./id1/s0.sav`, `./baseq2/save/s1`, `baseoa/q3config.cfg`),
  // which is `writes` in the engine's file system.
  const einWrote = (path: string) => {
    const name = path.replace(/^\.?\/+/, '').replace(/^[^/]+\//, '');
    const at = `${writes}/${name}`;
    if (!running.FS.isDir(running.FS.stat(at).mode)) {
      tell({ type: 'wrote', files: [{ name, data: running.FS.readFile(at) }] });
      return;
    }
    const inside = running.FS.readdir(at).filter((file) => file !== '.' && file !== '..');
    tell({ type: 'wrote', folder: name, files: inside.map((file) => ({ name: `${name}/${file}`, data: running.FS.readFile(`${at}/${file}`) })) });
  };
  const running = await create({
    canvas,
    instantiateWasm,
    print: log,
    printErr: log,
    einDisplay: () => display,
    einWrote,
    ...(message.music ? { einMusic: music } : {}),
    ...(online ? { einNet: network } : {}),
  });
  engine = running;

  for (const file of lazy) lazyFile(running.FS, file.path, file.url, file.size);
  for (const file of files) {
    running.FS.mkdirTree(file.path.slice(0, file.path.lastIndexOf('/')));
    running.FS.writeFile(file.path, file.data);
  }
  const argv = running._malloc(args.length * 4);
  args.forEach((arg, i) => running.HEAPU32[(argv >> 2) + i] = running.stringToNewUTF8(arg));
  if (sampleRate) {
    rate = sampleRate;
    running._ein_audio_rate(rate);
    soundAt = performance.now();
  }
  const text = running.stringToNewUTF8(commands ?? '');
  if (family === 'quake') running._ein_start(args.length, argv, heap ?? 0, text);
  else if (family === 'quake2') running._ein_start(args.length, argv, text);
  else running._ein_start(args.length, argv);
  tell({ type: 'started' });
}

/** What the engine has drawn since the last frame handed over, as a picture to hand the page; none when it has drawn nothing new. */
function frameOf(running: EngineModule): ImageBitmap | undefined {
  if (running._ein_frames() === drawn) return undefined;
  drawn = running._ein_frames();
  if (pixels) {
    const width = running._ein_width!();
    const height = running._ein_height!();
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const at = running._ein_screen!();
    // The engine keeps its frame as R, G, B, A bytes already; the heap is looked up each time, as
    // memory growth replaces it.
    pixels.putImageData(new ImageData(new Uint8ClampedArray(running.HEAPU8.buffer, at, width * height * 4), width, height), 0, 0);
  }
  return canvas.transferToImageBitmap();
}

/** Run a frame and say what came of it: what was drawn, the sound since the last tick, and the menu's and fullscreen's state. */
function tick(running: EngineModule, datagrams: Datagram[]) {
  for (const datagram of datagrams) sockets.get(datagram.to)?.push(datagram);
  running._ein_tick();
  const transfer: Transferable[] = [];
  const frame = frameOf(running);
  if (frame) transfer.push(frame);
  let sound: Int16Array<ArrayBuffer> | undefined;
  if (rate) {
    const now = performance.now();
    const most = Math.floor(rate * MAX_SOUND);
    const count = Math.min(Math.floor((now - soundAt) * rate / 1000), most);
    soundAt = count === most ? now : soundAt + count * 1000 / rate;
    if (count > 0) {
      if (count > soundFrames) {
        soundFrames = count;
        soundBuffer = running._malloc(count * 4);
      }
      running._ein_audio_render(soundBuffer, count);
      sound = running.HEAP16.slice(soundBuffer >> 1, (soundBuffer >> 1) + count * 2);
      transfer.push(sound.buffer);
    }
  }
  tell({ type: 'frame', frame, sound, menu: running._ein_menu() !== 0, fullscreen: running._ein_fullscreen() !== 0 }, transfer);
}

scope.onmessage = ({ data: message }: MessageEvent<ToWorker>) => {
  if (message.type === 'start') {
    start(message).catch(end);
    return;
  }
  if (message.type === 'stop') {
    scope.close();
    return;
  }
  const running = engine;
  if (!running) return;
  try {
    switch (message.type) {
      case 'tick':
        tick(running, message.datagrams);
        break;
      case 'key':
        running._ein_key(message.pressed ? 1 : 0, message.key);
        break;
      case 'char':
        running._ein_char?.(message.character);
        break;
      case 'mouse':
        running._ein_mouse(message.dx, message.dy);
        break;
      case 'keep':
        running._ein_write_config();
        break;
      case 'disconnect':
        running._ein_disconnect();
        break;
      case 'fullscreen':
        running._ein_set_fullscreen(message.on ? 1 : 0);
        break;
    }
  } catch (error) {
    end(error);
  }
};
