import type { RunningGame, StartOptions } from '@games/adapter';
import { fetchFile, keyControls, startWorkerGame, type WholeFile } from '@games/worker';
import type { InstalledGame } from '../../lib/api.ts';
import { ASSETS, build, lazyPaks, looseFiles } from './files.ts';
import { quake3Character, quake3Key, quake3MouseKey, WHEEL } from './keys.ts';
import type { QuakeStart } from './start.ts';

/** Where the engine has the game's folder (`fs_basepath`), and the player's files of it (`fs_homepath`). */
const BASE = '/q3';
const HOME = '/home';

/** The file of commands the page runs once the game's configuration has, in the home folder. */
const COMMANDS = 'ein.cfg';

/**
 * The folder id's demo is played in, and the pk3 of ioquake3's own game code it is played with
 * (`assets/quake3-vm.pk3`): the demo's QVMs are older than ioquake3 runs. Its name sorts after the
 * demo's `pak0.pk3`, so its QVMs are the ones loaded.
 */
const DEMO = 'demoq3';
const DEMO_VM = { asset: `${ASSETS}/quake3-vm.pk3`, name: 'zz-ioquake3.pk3' };

/** WASD beside the arrows, as players have moved since: what a player without a q3config.cfg starts with. */
const WASD = ['bind w +forward', 'bind s +back', 'bind a +moveleft', 'bind d +moveright', 'bind mouse1 +attack', 'bind space +moveup'];

/**
 * The CD key in a key file's text: its first line that has one, the 16 letters and digits of it, as
 * it is printed (`ABCD-EFGH-…`) or as Quake III writes it in `q3key`, followed by its comments.
 */
function cdKeyOf(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const key = line.replace(/[\s-]/g, '');
    if (/^[a-z0-9]{16}$/i.test(key)) return key.toLowerCase();
  }
  return undefined;
}

/**
 * Start the Quake 3 game `game` in the module's engine worker (`engine-worker.ts`), which reads its
 * pk3s from EiN as ioquake3 asks for them. The files beside them, for id's demo ioquake3's own game
 * code, and the household's CD key are handed over whole.
 *
 * A player whose q3config.cfg has no name of their own plays under `name`, their account's. With
 * `map` the game starts on that map; with `online` it connects to a server once it has started,
 * through `online.network`.
 */
export async function startQuake3({ game, sound, log, kept, onKeep, name, map, online }: StartOptions<InstalledGame>): Promise<RunningGame> {
  const gamedir = game.gamedir ?? 'baseq3';
  const folder = `${BASE}/${gamedir}`;
  const home = `${HOME}/${gamedir}`;
  const files = await looseFiles(game, folder);
  if (gamedir === DEMO) files.push({ path: `${folder}/${DEMO_VM.name}`, data: await fetchFile(DEMO_VM.asset) });
  // The household's CD key, in the game's folder, where Quake 3 looks for q3key after the player's
  // own home: a key the player typed in the game's menu comes first.
  const key = game.cdkey ? cdKeyOf(new TextDecoder().decode(await fetchFile(`${game.path}/${game.cdkey}`))) : undefined;
  if (key) files.push({ path: `${folder}/q3key`, data: new TextEncoder().encode(`${key}\n`) });

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
  const mine: WholeFile[] = [
    ...kept.map((file) => ({ path: `${home}/${file.name}`, data: file.data })),
    { path: `${home}/${COMMANDS}`, data: new TextEncoder().encode(commands.join('\n') + '\n') },
  ];

  return await startWorkerGame<QuakeStart>('quake', 'engine', {
    payload: { family: 'quake3', build: build('quake3'), writes: home, args },
    lazy: lazyPaks(game, folder, game.paks),
    files: [...files, ...mine],
    // Quake 3's keys, and the characters they type for its text fields and console.
    controls(post) {
      const keys = keyControls(post, { key: quake3Key, button: quake3MouseKey, wheel: WHEEL.quake3 });
      let shift = false;
      return {
        ...keys,
        key(pressed, code) {
          if (code === 'ShiftLeft' || code === 'ShiftRight') shift = pressed;
          const taken = keys.key(pressed, code);
          const character = pressed ? quake3Character(code, shift) : undefined;
          if (character) post({ type: 'char', character: character.charCodeAt(0) });
          return taken;
        },
      };
    },
  }, { sound, log, onKeep, online });
}
