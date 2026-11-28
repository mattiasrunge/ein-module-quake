import type { RunningGame, StartOptions } from '@games/adapter';
import { fetchFile, startWorkerGame, type WholeFile } from '@games/worker';
import type { InstalledGame } from '../../lib/api.ts';
import { sharedBinds } from './binds.ts';
import { ASSETS, build, lazyPaks, looseFiles } from './files.ts';
import { quake3Key, quake3MouseKey, WHEEL } from './keys.ts';
import type { QuakeStart } from './start.ts';
import { typingControls } from './typing.ts';

/** Where the engine has the game's folder (`fs_basepath`), and the player's files of it (`fs_homepath`). */
const BASE = '/q3';
const HOME = '/home';

/** The file of commands the page runs once the game's configuration has, in the home folder. */
const COMMANDS = 'ein.cfg';

/**
 * The game code the module brings, by the folder the game is played in, as pk3s whose names sort
 * after the game's own, so their QVMs are the ones loaded: ioquake3's menus for id's game and its
 * demo (`assets/quake3-ui.pk3`), which list the modes the engine offers, widescreen ones too, and
 * for the demo ioquake3's cgame and qagame (`assets/quake3-game.pk3`), since the demo's are older than
 * ioquake3 runs; OpenArena's own menus, patched alike (`assets/openarena-ui.pk3`).
 */
const OWN_CODE: Record<string, { asset: string; name: string }[]> = {
  baseq3: [{ asset: 'quake3-ui.pk3', name: 'zz-ein-ui.pk3' }],
  demoq3: [{ asset: 'quake3-ui.pk3', name: 'zz-ein-ui.pk3' }, { asset: 'quake3-game.pk3', name: 'zz-ein-game.pk3' }],
  baseoa: [{ asset: 'openarena-ui.pk3', name: 'zz-ein-ui.pk3' }],
};

/** WASD beside the arrows, as players have moved since: what a player without a q3config.cfg starts with. */
const WASD = ['bind w +forward', 'bind s +back', 'bind a +moveleft', 'bind d +moveright', 'bind mouse1 +attack', 'bind space +moveup'];

/**
 * Start the Quake 3 game `game` in the module's engine worker (`engine-worker.ts`), which reads its
 * pk3s from EiN as ioquake3 asks for them. The files beside them and the game code the module brings
 * for it are handed over whole.
 *
 * A player whose q3config.cfg has no name of their own plays under `name`, their account's. With
 * `map` the game starts on that map; with `online` it connects to a server once it has started,
 * through `online.network`. With `servers` the server browser's LAN list finds every server of the
 * game, and joins any of them.
 */
export async function startQuake3({ game, sound, log, kept, onKeep, name, map, online, servers }: StartOptions<InstalledGame>): Promise<RunningGame> {
  const gamedir = game.gamedir ?? 'baseq3';
  const folder = `${BASE}/${gamedir}`;
  const home = `${HOME}/${gamedir}`;
  const files = await looseFiles(game, folder);
  for (const pk3 of OWN_CODE[gamedir] ?? []) files.push({ path: `${folder}/${pk3.name}`, data: await fetchFile(`${ASSETS}/${pk3.asset}`) });

  // The command line: the folders and the video and sound, which Quake 3 sets before it starts
  // drawing, then what runs once it has, which the page writes into a file of its own (Quake 3 would
  // split a command line's binds at their `+`). A browser goes fullscreen only on a key or a click,
  // so a game starts in the page; a player without a q3config.cfg draws at 1920 by 1080, one of the
  // modes the game's menu lists (`glimp_ein.c`), and moves with WASD; the wheel changes weapon, up
  // to the next, the other way round from Quake 3's own default.cfg, and the right button walks
  // forward, as in Quake and Quake II, where Quake 3's strafes.
  const config = kept.find((file) => file.name === 'q3config.cfg');
  const text = config ? new TextDecoder().decode(config.data) : undefined;
  const named = /^seta name "(.+)"/m.test(text ?? '');
  const commands = [...(config ? [] : WASD), ...sharedBinds('quake3', text), ...(name && !named ? [`set name "${name.replace(/"/g, '')}"`] : [])];
  const set = (cvar: string, value: string) => ['+set', cvar, value];
  const args = [
    'quake3',
    ...set('fs_basepath', BASE),
    ...set('fs_homepath', HOME),
    ...set('com_basegame', gamedir),
    ...set('r_fullscreen', '0'),
    // The message of the day comes from id's update server, which EiN's network has no name for.
    ...set('cl_motd', '0'),
    ...(config ? [] : [...set('r_mode', '-1'), ...set('r_customwidth', '1920'), ...set('r_customheight', '1080')]),
    ...(sound ? [] : set('s_initsound', '0')),
    '+exec',
    COMMANDS,
    ...(map ? ['+map', map] : []),
    ...(online ? ['+connect', online.address] : []),
  ];
  const mine: WholeFile[] = [
    ...kept.map((file) => ({ path: `${home}/${file.name}`, data: file.data })),
    { path: `${home}/${COMMANDS}`, data: new TextEncoder().encode(commands.join('\n') + '\n') },
  ];

  return await startWorkerGame<QuakeStart>('quake', 'engine', {
    payload: { family: 'quake3', build: build('quake3'), writes: home, args },
    lazy: lazyPaks(game, folder, game.paks),
    files: [...files, ...mine],
    // Quake 3's keys, and the characters they type for its text fields and console.
    controls: (post) => typingControls(post, { key: quake3Key, button: quake3MouseKey, wheel: WHEEL.quake3 }),
  }, { sound, log, onKeep, online, servers });
}
