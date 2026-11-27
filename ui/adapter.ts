import { execCommand } from '@ein/ui/signals';
import type { GameAdapter } from '@games/adapter';
import type { Game } from '../lib/api.ts';
import { startEngine } from './quake/engine.ts';
import { mouseKey, quakeKey, WHEEL } from './quake/keys.ts';
import { startQuake3 } from './quake/quake3.ts';

/**
 * The files a player keeps of a game, by their paths in their saves folder of it. Quake's saves are
 * `s0.sav` to `s11.sav` in its menus. Quake II's are a folder a slot, `save/<slot>/`, with the
 * game's `server.ssv` and `game.ssv` and each level's `.sav` and `.sv2`; `save/current`, the game
 * in progress, is the engine's own. Both keep `config.cfg`; Quake 3 keeps `q3config.cfg` and, for
 * id's whole game, the player's CD key in `q3key`, and no saves. A folder is one game's, so the files
 * of an engine that does not play it are never there.
 */
const KEPT = /^(config\.cfg|q3config\.cfg|q3key|s\d+\.sav|save\/(?!current\/)[^/]+\/[^/]+)$/;

/** Quake, Quake II and Quake 3 on the games module's page for a game and its dashboard card. */
export const adapter: GameAdapter<Game> = {
  module: 'quake',
  title: 'Quake',
  list: () => execCommand<Game[]>('quake-games'),
  async start({ game, ...options }) {
    if (game.state !== 'installed') throw new Error(`${game.title} is not here yet`);
    if (game.family === 'quake3') return await startQuake3({ game, ...options });
    const engine = await startEngine({ game, ...options });
    const wheel = WHEEL[game.family];
    const press = (pressed: boolean, key: number | undefined): boolean => {
      if (key === undefined) return false;
      engine.key(pressed, key);
      return true;
    };
    return {
      width: engine.width,
      height: engine.height,
      frames: engine.frames,
      draw: engine.draw,
      step: engine.tick,
      key: (pressed, code) => press(pressed, quakeKey(code)),
      button: (pressed, button) => press(pressed, mouseKey(button)),
      mouse: engine.mouse,
      wheel(up) {
        const key = up ? wheel.up : wheel.down;
        engine.key(true, key);
        engine.key(false, key);
      },
      keep: engine.writeConfig,
      disconnect: engine.disconnect,
      // The menus and the console are worked with the keys; Video Options or the Video menu sets fullscreen.
      menu: engine.menu,
      fullscreen: engine.fullscreen,
      setFullscreen: engine.setFullscreen,
    };
  },
  help: 'The mouse looks and fires, WASD or the arrows move, Space jumps, Shift runs, Escape is the menu, ` the console.',
  pointer: true,
  kept: { pattern: KEPT, depth: 2 },
  startsOnMap: true,
};
