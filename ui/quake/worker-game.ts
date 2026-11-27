import { fileUrl, moduleWorker } from '@ein/ui/lib';
import type { MusicSink, RunningGame, StartOptions } from '@games/adapter';
import type { InstalledGame } from '../../lib/api.ts';
import type { Datagram, FromWorker, StartMessage, ToWorker, WholeFile } from './engine-messages.ts';

/** Where the module's built engines sit in EiN's tree. */
export const ASSETS = '/usr/modules/quake/assets';

/** The widest frame Quake 3 starts at, whatever the screen: wider takes more of the GPU than it shows. */
const MAX_WIDTH = 1920;

/** The sound kept waiting to be played, at most, in seconds: more is late, and the oldest is dropped. */
const MAX_QUEUED = 0.2;

/** Fetch a file as bytes; `/file/` needs the session's cookie, which a same-origin fetch sends. */
export async function fetchFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(fileUrl(path));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The files beside a game's paks, fetched whole, each at its path in `folder` of the engine's file system. */
export const looseFiles = (game: InstalledGame, folder: string): Promise<WholeFile[]> =>
  Promise.all(game.files.map(async (file) => ({ path: `${folder}/${file}`, data: await fetchFile(`${game.path}/${file}`) })));

/** The game's paks, by the names the engine loads them under in `folder`, read from EiN as it asks. */
export const lazyPaks = (game: InstalledGame, folder: string, names: string[]): StartMessage['lazy'] =>
  game.paks.map((pak, i) => ({ path: `${folder}/${names[i]}`, url: fileUrl(`${game.path}/${pak}`), size: game.sizes[i] }));

/**
 * The size Quake 3 starts drawing at when the player has chosen none (r_mode -2): the screen's, in
 * its pixels, as the game is shown fullscreen, but no wider than `MAX_WIDTH`.
 */
function displaySize(): { width: number; height: number } {
  const width = Math.min(MAX_WIDTH, Math.round(screen.width * devicePixelRatio));
  return { width, height: Math.round(width * screen.height / screen.width) };
}

/** What Quit ends a game with, as `quitted` recognises it: Emscripten's `ExitStatus` for exit(0). */
const quit = () => Object.assign(new Error('the game quit'), { name: 'ExitStatus', status: 0 });

/** How an engine takes the keys, the mouse's buttons and its wheel: what it posts to its worker for each. */
export type Controls = Pick<RunningGame, 'key' | 'button' | 'wheel'>;

/**
 * Start a game in the module's engine worker (`engine-worker.ts`) and answer it running for the
 * games module's page: `engine` says which engine, its build in `assets/` and what it is given,
 * `controls` how it takes the keys. Each animation frame the page sends the worker a tick, with the
 * datagrams that came for the game through `online.network`, and draws the frame it answers with;
 * the sound it mixes is played from a short queue, and its music, a CD's tracks (`music`), by the
 * page's player. The worker reads the game's paks from EiN a piece at a time as the engine asks for
 * them, so a game starts without downloading all of them.
 */
export async function startInWorker(
  engine: Omit<StartMessage, 'type' | 'glue' | 'wasm' | 'display' | 'sampleRate' | 'music' | 'online'> & { build: string },
  { sound, log, onKeep, online }: Pick<StartOptions<InstalledGame>, 'sound' | 'log' | 'onKeep' | 'online'>,
  music: { folder: string; tracks: Record<number, string> } | undefined,
  controls: (post: (message: ToWorker) => void) => Controls,
): Promise<RunningGame> {
  const worker = moduleWorker('quake', 'engine');
  const post = (message: ToWorker) => worker.postMessage(message);
  const started = Promise.withResolvers<void>();
  const player: MusicSink | undefined = music && sound?.music(music.folder, music.tracks);
  /** The ports the game opened, whose datagrams each tick hands over. */
  const ports = new Set<number>();
  /** The sound mixed and not played yet, interleaved 16-bit stereo, and how many frames of it there are. */
  const queue: Int16Array[] = [];
  let queued = 0;
  let playing = false;
  let frame: ImageBitmap | undefined;
  let frames = 0;
  let ticking = false;
  let menu = false;
  let fullscreen = false;
  let ended: Error | undefined;
  const finish = (error: Error) => {
    ended = error;
    ticking = false;
    started.reject(error);
  };
  worker.onmessage = ({ data: message }: MessageEvent<FromWorker>) => {
    switch (message.type) {
      case 'started':
        started.resolve();
        break;
      case 'log':
        log(message.line);
        break;
      case 'wrote':
        onKeep?.({ files: message.files, ...(message.folder ? { folder: message.folder } : {}) });
        break;
      case 'net-open':
        online?.network.open(message.port);
        ports.add(message.port);
        break;
      case 'net-send':
        online?.network.send(message.from, message.ip, message.to, message.data);
        break;
      case 'music':
        if (message.call === 'play') player?.play(message.track, message.looping);
        else if (message.call === 'stop') player?.stop();
        else if (message.call === 'pause') player?.pause(message.paused);
        else player?.volume(message.level);
        break;
      case 'frame':
        ticking = false;
        menu = message.menu;
        fullscreen = message.fullscreen;
        if (message.frame) {
          frame?.close();
          frame = message.frame;
          frames++;
        }
        if (message.sound) {
          queue.push(message.sound);
          queued += message.sound.length / 2;
          while (sound && queued > sound.context.sampleRate * MAX_QUEUED) queued -= queue.shift()!.length / 2;
        }
        break;
      case 'ended':
        finish(message.quit ? quit() : new Error(message.error ?? 'the game stopped'));
        break;
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    finish(new Error(event.message || 'the game stopped'));
  };
  const { build, ...rest } = engine;
  const display = displaySize();
  post({
    type: 'start',
    ...rest,
    glue: fileUrl(`${ASSETS}/${build}.js`),
    wasm: fileUrl(`${ASSETS}/${build}.wasm`),
    display,
    sampleRate: sound?.context.sampleRate,
    music: !!player,
    online: !!online,
  });
  try {
    await started.promise;
  } catch (error) {
    worker.terminate();
    throw error;
  }

  // The sound, from the queue: played once a whole buffer more than the page asks for is waiting, so
  // a tick a little late leaves no gap, and from then on as it comes.
  sound?.effects((left, right) => {
    if (!playing && queued >= left.length * 2) playing = true;
    let i = 0;
    while (playing && i < left.length && queue.length > 0) {
      const head = queue[0];
      const count = Math.min(left.length - i, head.length / 2);
      for (let j = 0; j < count; j++, i++) {
        left[i] = head[j * 2] / 32768;
        right[i] = head[j * 2 + 1] / 32768;
      }
      queued -= count;
      if (count === head.length / 2) queue.shift();
      else queue[0] = head.subarray(count * 2);
    }
    if (i < left.length) playing = false;
    left.fill(0, i);
    right.fill(0, i);
  });

  return {
    width: () => frame?.width ?? display.width,
    height: () => frame?.height ?? display.height,
    frames: () => frames,
    paint(context) {
      if (frame) context.drawImage(frame, 0, 0);
    },
    // A tick at a time: one the worker has not answered yet is not sent again.
    step() {
      if (ended) throw ended;
      if (ticking) return;
      ticking = true;
      const datagrams: Datagram[] = [];
      for (const port of online ? ports : []) {
        for (let datagram = online!.network.recv(port); datagram; datagram = online!.network.recv(port)) datagrams.push({ ...datagram, to: port });
      }
      post({ type: 'tick', datagrams });
    },
    ...controls(post),
    mouse: (dx, dy) => post({ type: 'mouse', dx, dy }),
    keep: () => post({ type: 'keep' }),
    disconnect: () => post({ type: 'disconnect' }),
    // The worker ends once it has done what it was asked before.
    stop() {
      post({ type: 'stop' });
      player?.stop();
      frame?.close();
      frame = undefined;
    },
    menu: () => menu,
    fullscreen: () => fullscreen,
    setFullscreen: (on) => post({ type: 'fullscreen', on }),
  };
}
