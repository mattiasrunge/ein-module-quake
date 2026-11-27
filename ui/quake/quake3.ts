import { fileUrl, moduleWorker } from '@ein/ui/lib';
import type { Kept, RunningGame, StartOptions } from '@games/adapter';
import type { InstalledGame } from '../../lib/api.ts';
import { quake3Character, quake3Key, quake3MouseKey, WHEEL } from './keys.ts';
import type { Datagram, FromWorker, ToWorker } from './quake3-messages.ts';

/** Where the module's built engines sit in EiN's tree. */
const ASSETS = '/usr/modules/quake/assets';

/** Where the engine has the game's folder (`fs_basepath`), and the player's files of it (`fs_homepath`). */
const BASE = '/q3';
const HOME = '/home';

/** The widest frame a game starts at, whatever the screen: wider takes more of the GPU than it shows. */
const MAX_WIDTH = 1920;

/** The file of commands the page runs once the game's configuration has, in the home folder. */
const COMMANDS = 'ein.cfg';

/**
 * The folder id's demo is played in, and the pk3 of ioquake3's own game code it is played with
 * (`assets/quake3-vm.pk3`): the demo's QVMs are older than ioquake3 runs. Its name sorts after the
 * demo's `pak0.pk3`, so its QVMs are the ones loaded.
 */
const DEMO = 'demoq3';
const DEMO_VM = { asset: `${ASSETS}/quake3-vm.pk3`, name: 'zz-ioquake3.pk3' };

/** The sound kept waiting to be played, at most, in seconds: more is late, and the oldest is dropped. */
const MAX_QUEUED = 0.2;

/** WASD beside the arrows, as players have moved since: what a player without a q3config.cfg starts with. */
const WASD = ['bind w +forward', 'bind s +back', 'bind a +moveleft', 'bind d +moveright', 'bind mouse1 +attack', 'bind space +moveup'];

/** Fetch a file as bytes; `/file/` needs the session's cookie, which a same-origin fetch sends. */
async function fetchFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(fileUrl(path));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The size a game starts drawing at when the player has chosen none (r_mode -2): the screen's, in
 * its pixels, as the game is shown fullscreen, but no wider than `MAX_WIDTH`.
 */
function displaySize(): { width: number; height: number } {
  const width = Math.min(MAX_WIDTH, Math.round(screen.width * devicePixelRatio));
  return { width, height: Math.round(width * screen.height / screen.width) };
}

/** What Quit ends a game with, as `quitted` recognises it: Emscripten's `ExitStatus` for exit(0). */
const quit = () => Object.assign(new Error('the game quit'), { name: 'ExitStatus', status: 0 });

/**
 * Start the Quake 3 game `game` and answer it running for the games module's page. ioquake3 runs in
 * a worker (`quake3-worker.ts`, the module's worker `quake3`), which reads the game's pk3s from EiN a piece at a time as the
 * engine asks for them, so a game starts without downloading all of them. The files beside them, and
 * for id's demo ioquake3's own game code, are handed over whole. Each animation frame the page sends
 * the worker a tick, with the datagrams that came for the game, and draws the frame it answers with.
 *
 * A player whose q3config.cfg has no name of their own plays under `name`, their account's. With
 * `map` the game starts on that map; with `online` it connects to a server once it has started,
 * through `online.network`.
 */
export async function startQuake3({ game, sound, log, kept, onKeep, name, map, online }: StartOptions<InstalledGame>): Promise<RunningGame> {
  const gamedir = game.gamedir ?? 'baseq3';
  const files = await Promise.all(game.files.map(async (file) => ({ name: file, data: await fetchFile(`${game.path}/${file}`) })));
  if (gamedir === DEMO) files.push({ name: DEMO_VM.name, data: await fetchFile(DEMO_VM.asset) });

  // The command line: the folders and the video and sound, which Quake 3 sets before it starts
  // drawing, then what runs once it has, which the page writes into a file of its own (Quake 3 would
  // split a command line's binds at their `+`). A browser goes fullscreen only on a key or a click,
  // so a game starts in the page; a player without a q3config.cfg draws at the screen's size and
  // moves with WASD.
  const config = kept.find((file) => file.name === 'q3config.cfg');
  const named = /^seta name "(.+)"/m.test(config ? new TextDecoder().decode(config.data) : '');
  const commands = [...(config ? [] : WASD), ...(name && !named ? [`set name "${name.replace(/"/g, '')}"`] : [])];
  const set = (cvar: string, value: string) => ['+set', cvar, value];
  const args = [
    'quake3',
    ...set('fs_basepath', BASE),
    ...set('fs_homepath', HOME),
    ...set('com_basegame', gamedir),
    ...set('r_fullscreen', '0'),
    // The message of the day comes from id's update server, which EiN's network has no name for.
    ...set('cl_motd', '0'),
    ...(config ? [] : set('r_mode', '-2')),
    ...(sound ? [] : set('s_initsound', '0')),
    '+exec',
    COMMANDS,
    ...(map ? ['+map', map] : []),
    ...(online ? ['+connect', online.address] : []),
  ];
  const home: Kept[] = [...kept, { name: COMMANDS, data: new TextEncoder().encode(commands.join('\n') + '\n') }];

  const worker = moduleWorker('quake', 'quake3');
  const post = (message: ToWorker) => worker.postMessage(message);
  const started = Promise.withResolvers<void>();
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
        onKeep?.({ files: [{ name: message.name, data: message.data }] });
        break;
      case 'net-open':
        online?.network.open(message.port);
        ports.add(message.port);
        break;
      case 'net-send':
        online?.network.send(message.from, message.ip, message.to, message.data);
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
  const display = displaySize();
  post({
    type: 'start',
    glue: fileUrl(`${ASSETS}/quake3.js`),
    wasm: fileUrl(`${ASSETS}/quake3.wasm`),
    folder: `${BASE}/${gamedir}`,
    home: HOME,
    pk3s: game.paks.map((pak, i) => ({ name: pak, url: fileUrl(`${game.path}/${pak}`), size: game.sizes[i] })),
    files,
    kept: home.map((file) => ({ name: `${gamedir}/${file.name}`, data: file.data })),
    args,
    display,
    sampleRate: sound?.context.sampleRate,
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

  let shift = false;
  const press = (pressed: boolean, key: number | undefined): boolean => {
    if (key === undefined) return false;
    post({ type: 'key', pressed, key });
    return true;
  };
  const wheel = WHEEL.quake3;
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
    key(pressed, code) {
      if (code === 'ShiftLeft' || code === 'ShiftRight') shift = pressed;
      const taken = press(pressed, quake3Key(code));
      const character = pressed ? quake3Character(code, shift) : undefined;
      if (character) post({ type: 'char', character: character.charCodeAt(0) });
      return taken;
    },
    button: (pressed, button) => press(pressed, quake3MouseKey(button)),
    mouse: (dx, dy) => post({ type: 'mouse', dx, dy }),
    wheel(up) {
      const key = up ? wheel.up : wheel.down;
      press(true, key);
      press(false, key);
    },
    keep: () => post({ type: 'keep' }),
    disconnect: () => post({ type: 'disconnect' }),
    // The worker ends once it has done what it was asked before.
    stop() {
      post({ type: 'stop' });
      frame?.close();
      frame = undefined;
    },
    menu: () => menu,
    fullscreen: () => fullscreen,
    setFullscreen: (on) => post({ type: 'fullscreen', on }),
  };
}
