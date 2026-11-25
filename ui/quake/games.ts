import { shq } from '@ein/ui/lib';
import { execCommand } from '@ein/ui/signals';
import type { Game } from '../../lib/api.ts';
import { ENGINE_TITLES, GAMES, type Offer, OFFERS } from '../../lib/games.ts';

export type { Game, Offer };
export { ENGINE_TITLES, GAMES, OFFERS };

/**
 * The games in `GAMES`, as `quake-games` lists them. The folder is made when it is not there yet, so
 * the list is empty rather than an error before anything is fetched, and an upload has somewhere
 * to go.
 */
export async function listGames(): Promise<Game[]> {
  await execCommand(`mkdir -p ${shq(GAMES)}`);
  return await execCommand<Game[]>('quake-games');
}

/** Fetch the offered game `name` into its folder (`quake-fetch`), which takes as long as the download does. */
export async function fetchGame(name: string): Promise<void> {
  await execCommand(`quake-fetch ${shq(name)}`);
}

/** Delete the game's folder, paks and music of its own and all. */
export async function deleteGame(name: string): Promise<void> {
  await execCommand(`rm -r ${shq(`${GAMES}/${name}`)}`);
}
