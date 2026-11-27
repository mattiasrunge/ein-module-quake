import { fileUrl } from '@ein/ui/lib';
import type { RunningGame, StartOptions } from '@games/adapter';
import type { InstalledGame } from '../../lib/api.ts';
import { quake3Character, quake3Key, quake3MouseKey, WHEEL } from './keys.ts';

/** Where the module's built engines sit in EiN's tree. */
const ASSETS = '/usr/modules/quake/assets';

/** Where the engine has the game's folder (`fs_basepath`), and the player's files of it (`fs_homepath`). */
const BASE = '/q3';
const HOME = '/home';

/** The widest frame a game starts at, whatever the screen: wider takes more of the GPU than it shows. */
const MAX_WIDTH = 1920;

/** What Quake 3's glue (`assets/quake3.js`, Emscripten's, `engine/quake3/Containerfile`) gives back once the wasm runs. */
type Quake3Module = {
  FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array<ArrayBuffer>; mkdirTree(path: string): void };
  HEAP16: Int16Array;
  HEAPU32: Uint32Array;
  stringToNewUTF8(text: string): number;
  _malloc(bytes: number): number;
  _ein_start(argc: number, argv: number): void;
  _ein_tick(): void;
  _ein_key(pressed: number, key: number): void;
  _ein_char(character: number): void;
  _ein_mouse(dx: number, dy: number): void;
  _ein_write_config(): void;
  _ein_disconnect(): void;
  _ein_menu(): number;
  _ein_fullscreen(): number;
  _ein_set_fullscreen(on: number): void;
  _ein_audio_rate(rate: number): void;
  _ein_audio_render(buffer: number, frames: number): void;
};

/** The file of commands the page runs once the game's configuration has, in the home folder. */
const COMMANDS = 'ein.cfg';

/** WASD beside the arrows, as players have moved since: what a player without a q3config.cfg starts with. */
const WASD = ['bind w +forward', 'bind s +back', 'bind a +moveleft', 'bind d +moveright', 'bind mouse1 +attack', 'bind space +moveup'];

/** Fetch a file as bytes; `/file/` needs the session's cookie, which a same-origin fetch sends. */
async function fetchFile(path: string): Promise<Uint8Array> {
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

/**
 * Load the Quake 3 game `game`'s engine, pk3s and files and start it, as `startEngine` starts
 * Quake's and Quake II's, and answer it running for the games module's page. It draws with WebGL on
 * a canvas of its own, which the page never shows: `draw` reads each frame back into the page's.
 *
 * A player whose q3config.cfg has no name of their own plays under `name`, their account's. With
 * `map` the game starts on that map; with `online` it connects to a server once it has started,
 * through `online.network`.
 */
export async function startQuake3({ game, sound, log, kept, onKeep, name, map, online }: StartOptions<InstalledGame>): Promise<RunningGame> {
  const gamedir = game.gamedir ?? 'baseq3';
  const glueUrl = fileUrl(`${ASSETS}/quake3.js`);
  const [glue, wasmBinary, paks, files] = await Promise.all([
    import(glueUrl) as Promise<{ default: (options: object) => Promise<Quake3Module> }>,
    fetchFile(`${ASSETS}/quake3.wasm`),
    Promise.all(game.paks.map((pak) => fetchFile(`${game.path}/${pak}`))),
    Promise.all(game.files.map((file) => fetchFile(`${game.path}/${file}`))),
  ]);

  const canvas = document.createElement('canvas');
  // Called by `ein_wrote` once the game has written a file, at its path in the home folder
  // (`baseoa/q3config.cfg`); `engine` is set by then.
  const einWrote = (path: string) => {
    onKeep?.({ files: [{ name: path.replace(/^[^/]+\//, ''), data: engine.FS.readFile(`${HOME}/${path}`) }] });
  };
  // The glue would fetch the wasm again beside itself unless it is handed the instance.
  const instantiateWasm = (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => {
    void WebAssembly.instantiate(wasmBinary as Uint8Array<ArrayBuffer>, imports).then(({ instance }) => receive(instance));
    return {};
  };
  const engine = await glue.default({ canvas, instantiateWasm, print: log, printErr: log, einDisplay: displaySize, einWrote, einNet: online?.network });

  // The pk3s under their own names, which say the order the engine loads them in, and the files
  // beside them; the player's q3config.cfg in the home folder.
  const folder = `${BASE}/${gamedir}`;
  engine.FS.mkdirTree(folder);
  paks.forEach((bytes, i) => engine.FS.writeFile(`${folder}/${game.paks[i]}`, bytes));
  game.files.forEach((file, i) => {
    const at = `${folder}/${file}`;
    engine.FS.mkdirTree(at.slice(0, at.lastIndexOf('/')));
    engine.FS.writeFile(at, files[i]);
  });
  engine.FS.mkdirTree(`${HOME}/${gamedir}`);
  for (const file of kept) {
    const at = `${HOME}/${gamedir}/${file.name}`;
    engine.FS.mkdirTree(at.slice(0, at.lastIndexOf('/')));
    engine.FS.writeFile(at, file.data);
  }

  // The command line: the folders and the video and sound, which Quake 3 sets before it starts
  // drawing, then what runs once it has, which the page writes into a file of its own (Quake 3 would
  // split a command line's binds at their `+`). A browser goes fullscreen only on a key or a click,
  // so a game starts in the page; a player without a q3config.cfg draws at the screen's size and
  // moves with WASD.
  const config = kept.find((file) => file.name === 'q3config.cfg');
  const named = /^seta name "(.+)"/m.test(config ? new TextDecoder().decode(config.data) : '');
  const commands = [...(config ? [] : WASD), ...(name && !named ? [`set name "${name.replace(/"/g, '')}"`] : [])];
  engine.FS.writeFile(`${HOME}/${gamedir}/${COMMANDS}`, new TextEncoder().encode(commands.join('\n') + '\n'));
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
  const argv = engine._malloc(args.length * 4);
  args.forEach((arg, i) => engine.HEAPU32[(argv >> 2) + i] = engine.stringToNewUTF8(arg));
  if (sound) engine._ein_audio_rate(sound.context.sampleRate);
  engine._ein_start(args.length, argv);

  // The effects and the music: interleaved 16-bit stereo from the game's mixer, into a buffer kept for them.
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

  // The frame is read back from WebGL while it is still there: the page draws it in the same
  // animation frame the game ran in, before the browser clears it.
  const gl = canvas.getContext('webgl2')!;
  let pixels = new Uint8Array(0);
  let frames = 0;
  let shift = false;
  const press = (pressed: boolean, key: number | undefined): boolean => {
    if (key === undefined) return false;
    engine._ein_key(pressed ? 1 : 0, key);
    return true;
  };
  const wheel = WHEEL.quake3;
  return {
    width: () => canvas.width,
    height: () => canvas.height,
    frames: () => frames,
    draw(image) {
      const row = image.width * 4;
      if (pixels.length !== row * image.height) pixels = new Uint8Array(row * image.height);
      gl.readPixels(0, 0, image.width, image.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      // WebGL's rows go bottom up, a canvas's top down.
      for (let y = 0; y < image.height; y++) image.data.set(pixels.subarray((image.height - 1 - y) * row, (image.height - y) * row), y * row);
    },
    step() {
      engine._ein_tick();
      frames++;
    },
    key(pressed, code) {
      if (code === 'ShiftLeft' || code === 'ShiftRight') shift = pressed;
      const taken = press(pressed, quake3Key(code));
      const character = pressed ? quake3Character(code, shift) : undefined;
      if (character) engine._ein_char(character.charCodeAt(0));
      return taken;
    },
    button: (pressed, button) => press(pressed, quake3MouseKey(button)),
    mouse: (dx, dy) => engine._ein_mouse(dx, dy),
    wheel(up) {
      const key = up ? wheel.up : wheel.down;
      engine._ein_key(1, key);
      engine._ein_key(0, key);
    },
    keep: () => engine._ein_write_config(),
    disconnect: () => engine._ein_disconnect(),
    menu: () => engine._ein_menu() !== 0,
    fullscreen: () => engine._ein_fullscreen() !== 0,
    setFullscreen: (on) => engine._ein_set_fullscreen(on ? 1 : 0),
  };
}
