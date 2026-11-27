import type { RunningGame, StartOptions } from '@games/adapter';
import { keyControls, startWorkerGame } from '@games/worker';
import type { EngineName, InstalledGame } from '../../lib/api.ts';
import { sharedBinds } from './binds.ts';
import { build, lazyPaks, looseFiles } from './files.ts';
import { mouseKey, quake2Key, quake3MouseKey, quakeKey, WHEEL } from './keys.ts';
import type { QuakeStart } from './start.ts';
import { typingControls } from './typing.ts';

/** The megabytes Quake's own allocator gets: what LibreQuake's larger maps need, with room to spare. */
const HEAP = 64;

/**
 * What differs between Quake's and Quake II's engines: the build in `assets/`, the game's folder in
 * the engine's file system, its command line, the commands it runs once its own configuration has,
 * and the name a player has in their config.cfg.
 */
type EngineSpec = {
  build: string;
  folder: string;
  /** The command line, without or with sound; `first` when the player has no config.cfg of their own. */
  args(sound: boolean, first: boolean): string[];
  /** The commands after the game's configuration: `first` when the player has no config.cfg of their own. */
  commands(first: boolean): string[];
  /** The name a player has in their config.cfg, `undefined` when it is the engine's own first one or none. */
  playerName(config: string): string | undefined;
};

/** WASD beside the arrows, as players have moved since: what a player without a config.cfg starts with. */
const WASD = ['bind w +forward', 'bind s +back', 'bind a +moveleft', 'bind d +moveright'];

/** Quake 3's is started by `startQuake3` (`quake3.ts`). */
const ENGINES: Record<Exclude<EngineName, 'quake3'>, EngineSpec> = {
  quake: {
    build: 'quake',
    folder: '/id1',
    args: (sound) => ['quake', ...(sound ? [] : ['-nosound'])],
    // Mouse look, as players have played since, which Quake does not keep in config.cfg. Always Run is
    // the speeds Quake's Options set. A player without a config.cfg plays at 1280 by 720, one of the
    // modes Video Options lists, which config.cfg then keeps.
    commands: (first) => ['+mlook', ...(first ? [...WASD, 'cl_forwardspeed 400', 'cl_backspeed 400', 'crosshair 1', 'vid_width 1280', 'vid_height 720'] : [])],
    // Quake keeps the name as _cl_name; "player" is what everyone starts with.
    playerName: (config) => /^_cl_name "(.*)"/m.exec(config)?.[1].replace(/^player$/i, '') || undefined,
  },
  quake2: {
    build: 'quake2',
    folder: '/baseq2',
    // The frame's size, 1280 by 720 as Quake's, and its filtering are the engine's defaults
    // (`glimp_ein.c`), which config.cfg keeps as the Video menu sets them.
    args: (sound) => ['quake2', ...(sound ? [] : ['+set', 's_initsound', '0'])],
    // Free look is Quake 2's mouse look, and config.cfg keeps it.
    commands: (first) => first ? [...WASD, 'set freelook 1', 'set cl_run 1', 'set crosshair 1'] : [],
    // "unnamed" is what everyone starts with, or "Player", which the game's default.cfg sets.
    playerName: (config) => /^set name "(.*)"/m.exec(config)?.[1].replace(/^(unnamed|player)$/i, '') || undefined,
  },
};

/**
 * Start the Quake or Quake II game `game` in the module's engine worker (`engine-worker.ts`), which
 * reads its paks from EiN as the engine asks for them, under the names the engine loads them by
 * (`pak0.pak` and on) in its own folder, `/id1` or `/baseq2`, whatever the folder is called here. The
 * files beside them and the player's saves and config.cfg are handed over whole, into the same
 * folder; the game's music, when it has any, is played by the page.
 *
 * A player whose config.cfg has no name of their own plays under `name`, their account's. With `map`
 * the game starts on that map, as `+map` on its command line does; with `online` it connects to a
 * server once it has started, through `online.network`.
 */
export async function startEngine({ game, sound, log, kept, onKeep, name, map, online }: Omit<StartOptions<InstalledGame>, 'demo'>): Promise<RunningGame> {
  const family = game.family;
  if (family === 'quake3') throw new Error(`${game.title} is a Quake 3 game, which startQuake3 starts`);
  const spec = ENGINES[family];
  const config = kept.find((file) => file.name === 'config.cfg');
  const text = config ? new TextDecoder().decode(config.data) : undefined;
  // The wheel changes weapon, up to the next, and the right button walks forward, in every game.
  const commands = [...spec.commands(!config), ...sharedBinds(family, text)];
  if (name && !spec.playerName(text ?? '')) commands.push(`name "${name.replace(/"/g, '')}"`);
  if (online) commands.push(`connect ${online.address}`);
  const files = [...await looseFiles(game, spec.folder), ...kept.map((file) => ({ path: `${spec.folder}/${file.name}`, data: file.data }))];

  return await startWorkerGame<QuakeStart>('quake', 'engine', {
    payload: {
      family,
      build: build(spec.build),
      writes: spec.folder,
      args: [...spec.args(!!sound, !config), ...(map ? ['+map', map] : [])],
      commands: commands.join('\n') + '\n',
      ...(family === 'quake' ? { heap: HEAP } : {}),
    },
    lazy: lazyPaks(game, spec.folder, game.paks.map((_, i) => `pak${i}.pak`)),
    files,
    // A game without music of its own is silent when it asks for a track.
    music: { folder: game.music?.folder ?? game.path, tracks: game.music?.tracks ?? {} },
    // Yamagi Quake II numbers its keys as Quake 3 does, and takes the characters they type apart.
    controls: (post) =>
      family === 'quake2'
        ? typingControls(post, { key: quake2Key, button: quake3MouseKey, wheel: WHEEL.quake2 })
        : keyControls(post, { key: quakeKey, button: mouseKey, wheel: WHEEL[family] }),
  }, { sound, log, onKeep, online });
}
