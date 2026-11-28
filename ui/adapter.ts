import { shq } from '@ein/ui/lib';
import { execCommand } from '@ein/ui/signals';
import type { GameAdapter, Written } from '@games/adapter';
import type { Game } from '../lib/api.ts';
import { startEngine } from './quake/engine.ts';
import { heardKept, heardWritten, QuakePad } from './quake/pad.tsx';
import { startQuake3 } from './quake/quake3.ts';

/**
 * The files a player keeps of a game, by their paths in their saves folder of it. Quake's saves are
 * `s0.sav` to `s11.sav` in its menus. Quake II's are a folder a slot, `save/<slot>/`, with the
 * game's `server.ssv` and `game.ssv` and each level's `.sav` and `.sv2`; `save/current`, the game
 * in progress, is the engine's own. Both keep `config.cfg`; Quake 3 keeps `q3config.cfg` and no saves. A
 * folder is one game's, so the files of an engine that does not play it are never there.
 */
const KEPT = /^(config\.cfg|q3config\.cfg|s\d+\.sav|save\/(?!current\/)[^/]+\/[^/]+)$/;

/** Quake, Quake II and Quake 3 on the games module's page for a game and its dashboard card. */
export const adapter: GameAdapter<Game> = {
  module: 'quake',
  title: 'Quake',
  list: (path) => execCommand<Game[]>(path ? `quake-games ${shq(path)}` : 'quake-games'),
  // A game is listed by its folder, so it can be shared by a link to it.
  shares: true,
  async start({ game, onKeep, ...options }) {
    if (game.state !== 'installed') throw new Error(`${game.title} is not here yet`);
    // The keys' drawing (`QuakePad`) shows the binds the game starts with and those it writes.
    heardKept(game, options.kept);
    const keep = onKeep && ((written: Written) => (heardWritten(game, written), onKeep(written)));
    // Each engine runs in the module's worker; the menus and the console of Quake and Quake II are
    // worked with the keys, Quake 3's with its pointer too.
    return game.family === 'quake3' ? await startQuake3({ game, onKeep: keep, ...options }) : await startEngine({ game, onKeep: keep, ...options });
  },
  help: 'The mouse looks and fires, WASD or the arrows move, Space jumps, Shift runs, Escape is the menu, ` the console.',
  // The player's binds on the keyboard and the mouse, which the games page shows where a keyboard
  // plays, beside the menu and the console's keys.
  keys: {
    Pad: QuakePad,
    shortcuts: [
      { key: 'Esc', icon: 'menu-2', label: 'Menu' },
      { key: '`', icon: 'terminal-2', label: 'Console' },
    ],
  },
  pointer: true,
  kept: { pattern: KEPT, depth: 2 },
  startsOnMap: true,
};
