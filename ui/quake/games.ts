import { shq } from '@ein/ui/lib';
import { execCommand } from '@ein/ui/signals';
import type { Game } from '../../lib/api.ts';
import { GAMES } from '../../lib/games.ts';

export type { Game };
export { GAMES };

/**
 * The games in `GAMES`, as `quake-games` lists them. The folder is made when it is not there yet, so
 * the list is empty rather than an error before the services fill it, and an upload has somewhere
 * to go.
 */
export async function listGames(): Promise<Game[]> {
  await execCommand(`mkdir -p ${shq(GAMES)}`);
  return await execCommand<Game[]>('quake-games');
}

/** Delete the game's folder, paks and music of its own and all. */
export async function deleteGame(name: string): Promise<void> {
  await execCommand(`rm -r ${shq(`${GAMES}/${name}`)}`);
}
