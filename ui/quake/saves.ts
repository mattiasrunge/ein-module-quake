import { homePath } from '@ein/paths';
import { fileUrl, type NodeChildEntry, shq } from '@ein/ui/lib';
import { execCommand } from '@ein/ui/signals';
import type { EngineName } from '../../lib/api.ts';

/**
 * Where `username` keeps what they have of `game`: its saved games and their `config.cfg`, the
 * game's key bindings and settings. A folder of their home's, one for each game, so a save is only
 * ever loaded into the game it was made in. Nobody else sees it.
 */
export const savesFolder = (username: string, game: string): string => `${homePath(username)}/.quake/${game}`;

/** One of the files a game keeps: its path in the game's folder, `s0.sav`, `config.cfg` or `save/s1/game.ssv`, and its bytes. */
export type Kept = { name: string; data: Uint8Array<ArrayBuffer> };

/**
 * What the game wrote at once: a file, or a Quake 2 save slot's folder (`folder`, `save/s1`) with all
 * its files, which replace whatever was kept of the slot before.
 */
export type Written = { files: Kept[]; folder?: string };

/**
 * The files each engine keeps. Quake's saves are `s0.sav` to `s11.sav` in its menus. Quake 2's are a
 * folder a slot, `save/<slot>/`, with the game's `server.ssv` and `game.ssv` and each level's `.sav`
 * and `.sv2`; `save/current`, the game in progress, is the engine's own. Both keep `config.cfg`.
 */
const KEPT_FILE: Record<EngineName, RegExp> = {
  quake: /^(s\d+\.sav|config\.cfg)$/,
  quake2: /^(config\.cfg|save\/(?!current\/)[^/]+\/[^/]+)$/,
};

/** The files in `folder` and its folders `depth` deep, by their paths in it. */
async function filesIn(folder: string, depth: number, prefix = ''): Promise<string[]> {
  const entries = await execCommand<NodeChildEntry[]>(`ls -l ${shq(prefix ? `${folder}/${prefix}` : folder)}`);
  const found: string[] = [];
  for (const entry of entries) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.node.type !== 'directory') found.push(name);
    else if (depth > 0) found.push(...await filesIn(folder, depth - 1, name));
  }
  return found;
}

/**
 * What the player keeps in `folder` of a game `engine` plays. The folder is made when it is not
 * there yet, so a first save has somewhere to go.
 */
export async function loadKept(folder: string, engine: EngineName): Promise<Kept[]> {
  await execCommand(`mkdir -p ${shq(folder)}`);
  const names = (await filesIn(folder, 2)).filter((name) => KEPT_FILE[engine].test(name));
  return await Promise.all(names.map(async (name) => {
    const response = await fetch(fileUrl(`${folder}/${name}`));
    if (!response.ok) throw new Error(`${name}: ${response.status} ${response.statusText}`);
    return { name, data: new Uint8Array(await response.arrayBuffer()) };
  }));
}

/**
 * Keep what the game writes in `folder`, one write after the other, in the order the game wrote them,
 * so a slot saved twice in quick succession ends with the later save. `onError` hears a write that
 * could not be kept.
 */
export function keeper(folder: string, onError: (error: unknown) => void): (written: Written) => void {
  let queue = Promise.resolve();
  const keep = async ({ files, folder: slot }: Written) => {
    if (slot) {
      const path = `${folder}/${slot}`;
      // Made first, so there is always something to remove.
      await execCommand(`mkdir -p ${shq(path)}`);
      await execCommand(`rm -r ${shq(path)}`);
    }
    for (const { name, data } of files) {
      const path = `${folder}/${name}`;
      await execCommand(`mkdir -p ${shq(path.slice(0, path.lastIndexOf('/')))}`);
      // PUT stores the body at the path as it is, binary or not, making the file or replacing it.
      const response = await fetch(fileUrl(path), { method: 'PUT', body: data });
      if (!response.ok) throw new Error(`${name}: ${response.status} ${response.statusText}`);
    }
  };
  return (written) => {
    queue = queue.then(() => keep(written)).then(() => undefined, onError);
  };
}
