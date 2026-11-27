import type { RunningGame, StartOptions } from '@games/adapter';
import type { EngineName, InstalledGame } from '../../lib/api.ts';
import { mouseKey, quakeKey, WHEEL } from './keys.ts';
import { lazyPaks, looseFiles, startInWorker } from './worker-game.ts';

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
    // the speeds Quake's Options set.
    commands: (first) => ['+mlook', ...(first ? [...WASD, 'cl_forwardspeed 400', 'cl_backspeed 400', 'crosshair 1'] : [])],
    // Quake keeps the name as _cl_name; "player" is what everyone starts with.
    playerName: (config) => /^_cl_name "(.*)"/m.exec(config)?.[1].replace(/^player$/i, '') || undefined,
  },
  quake2: {
    build: 'quake2',
    folder: '/baseq2',
    // 640 by 480 (sw_mode 3), as Quake's frame, for a player without a config.cfg, which keeps the mode
    // the Video menu sets; a mode on the command line would be set again after config.cfg. And without
    // the frame rate quake2generic draws in the corner (cg_drawfps, which no config.cfg keeps).
    args: (sound, first) => [
      'quake2',
      ...(first ? ['+set', 'sw_mode', '3'] : []),
      '+set',
      'cg_drawfps',
      '0',
      ...(sound ? [] : ['+set', 's_initsound', '0']),
    ],
    // Free look is Quake 2's mouse look, and config.cfg keeps it.
    commands: (first) => first ? [...WASD, 'set freelook 1', 'set cl_run 1', 'set crosshair 1'] : [],
    // "unnamed" is what everyone starts with, or "Player", which the game's default.cfg sets.
    playerName: (config) => /^set name "(.*)"/m.exec(config)?.[1].replace(/^(unnamed|player)$/i, '') || undefined,
  },
};

/**
 * Start the Quake or Quake II game `game` in the module's engine worker (`worker-game.ts`), which
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
  const commands = spec.commands(!config);
  if (name && !spec.playerName(config ? new TextDecoder().decode(config.data) : '')) commands.push(`name "${name.replace(/"/g, '')}"`);
  if (online) commands.push(`connect ${online.address}`);
  const files = [...await looseFiles(game, spec.folder), ...kept.map((file) => ({ path: `${spec.folder}/${file.name}`, data: file.data }))];

  const wheel = WHEEL[family];
  return await startInWorker(
    {
      family,
      build: spec.build,
      lazy: lazyPaks(game, spec.folder, game.paks.map((_, i) => `pak${i}.pak`)),
      files,
      writes: spec.folder,
      args: [...spec.args(!!sound, !config), ...(map ? ['+map', map] : [])],
      commands: commands.join('\n') + '\n',
      ...(family === 'quake' ? { heap: HEAP } : {}),
    },
    { sound, log, onKeep, online },
    // A game without music of its own is silent when it asks for a track.
    { folder: game.music?.folder ?? game.path, tracks: game.music?.tracks ?? {} },
    (post) => {
      const press = (pressed: boolean, key: number | undefined): boolean => {
        if (key === undefined) return false;
        post({ type: 'key', pressed, key });
        return true;
      };
      return {
        key: (pressed, code) => press(pressed, quakeKey(code)),
        button: (pressed, button) => press(pressed, mouseKey(button)),
        wheel(up) {
          press(true, up ? wheel.up : wheel.down);
          press(false, up ? wheel.up : wheel.down);
        },
      };
    },
  );
}
