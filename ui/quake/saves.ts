import { homePath } from '@ein/paths';
import { type NodeChildEntry, shq } from '@ein/ui/lib';
import { execCommand, execScript } from '@ein/ui/signals';

/**
 * Where `username` keeps what they have of `game`: its saved games and their `config.cfg`, Quake's
 * key bindings and settings. A folder of their home's, one for each game, so a save is only ever
 * loaded into the game it was made in. Nobody else sees it.
 */
export const savesFolder = (username: string, game: string): string => `${homePath(username)}/.quake/${game}`;

/** One of the files Quake keeps: its name, `s<N>.sav` or `config.cfg`, and its text. */
export type Kept = { name: string; text: string };

/** Quake's saves, `s0.sav` to `s11.sav` in its menus, and its `config.cfg`: text files both. */
export const KEPT_FILE = /^(s\d+\.sav|config\.cfg)$/;

/** The files in `folder`, which is made when it is not there yet, so a first save has somewhere to go. */
export async function loadKept(folder: string): Promise<Kept[]> {
  await execCommand(`mkdir -p ${shq(folder)}`);
  const entries = await execCommand<NodeChildEntry[]>(`ls -l ${shq(folder)}`);
  const names = entries.map((entry) => entry.name).filter((name) => KEPT_FILE.test(name));
  return await Promise.all(names.map(async (name) => ({ name, text: await execScript(`cat ${shq(`${folder}/${name}`)}`) })));
}

/**
 * Keep files in `folder` one after the other, in the order Quake wrote them, so a slot saved twice
 * in quick succession ends with the later save. `onError` hears a file that could not be kept.
 */
export function keeper(folder: string, onError: (error: unknown) => void): (file: Kept) => void {
  let queue = Promise.resolve();
  return (file) => {
    queue = queue
      .then(() => execCommand(`cat > ${shq(`${folder}/${file.name}`)}`, { stdin: file.text }))
      .then(() => undefined, onError);
  };
}
