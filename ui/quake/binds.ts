/**
 * The player's binds as the engines write them into config.cfg and q3config.cfg, one line a key
 * (`bind "w" "+forward"` in Quake's, `bind w "+forward"` in Quake II's and Quake 3's), and the binds
 * every player starts with that the games' own default.cfg leaves out or has otherwise.
 */
import type { EngineName } from '../../lib/api.ts';

/** The file each engine keeps the player's binds and settings in, by its name in their saves folder. */
export const CONFIG: Record<EngineName, string> = { quake: 'config.cfg', quake2: 'config.cfg', quake3: 'q3config.cfg' };

/** The command that changes to the next weapon and to the one before, in each engine's games. */
export const WEAPONS: Record<EngineName, { next: string; prev: string }> = {
  quake: { next: 'impulse 10', prev: 'impulse 12' },
  quake2: { next: 'weapnext', prev: 'weapprev' },
  quake3: { next: 'weapnext', prev: 'weapprev' },
};

/** The command bound to each key in a configuration's text, by the key's name upper-cased (`W`, `MWHEELUP`). */
export function bindsOf(config: string): Map<string, string> {
  const binds = new Map<string, string>();
  for (const [, quoted, bare, command] of config.matchAll(/^bind\s+(?:"([^"]*)"|(\S+))\s+"([^"]*)"/gim)) {
    binds.set((quoted ?? bare).toUpperCase(), command);
  }
  return binds;
}

/**
 * The binds that give the wheel the weapons, up the next and down the one before, unless the
 * player's configuration `config` has given it something else: a wheel bound to nothing, or the
 * other way round as Quake 3's own default.cfg binds it, is no player's choice.
 */
export function wheelBinds(family: EngineName, config: string | undefined): string[] {
  const { next, prev } = WEAPONS[family];
  const binds = bindsOf(config ?? '');
  const up = binds.get('MWHEELUP');
  const down = binds.get('MWHEELDOWN');
  const chosen = (up || down) && !(up === prev && down === next);
  return chosen ? [] : [`bind mwheelup "${next}"`, `bind mwheeldown "${prev}"`];
}
