/** The files the page starts an engine with: its build in `assets/`, the game's paks and the files beside them. */
import { fileUrl } from '@ein/ui/lib';
import type { EmscriptenBuild } from '@games/engine';
import { fetchFile, type LazyFile, type WholeFile } from '@games/worker';
import type { InstalledGame } from '../../lib/api.ts';

/** Where the module's built engines sit in EiN's tree. */
export const ASSETS = '/usr/modules/quake/assets';

/** The engine `name`'s build in `assets/`: its glue and its wasm. */
export const build = (name: string): EmscriptenBuild => ({ glue: fileUrl(`${ASSETS}/${name}.js`), wasm: fileUrl(`${ASSETS}/${name}.wasm`) });

/** The files beside a game's paks, fetched whole, each at its path in `folder` of the engine's file system. */
export const looseFiles = (game: InstalledGame, folder: string): Promise<WholeFile[]> =>
  Promise.all(game.files.map(async (file) => ({ path: `${folder}/${file}`, data: await fetchFile(`${game.path}/${file}`) })));

/** The game's paks, by the names the engine loads them under in `folder`, read from EiN as it asks. */
export const lazyPaks = (game: InstalledGame, folder: string, names: string[]): LazyFile[] =>
  game.paks.map((pak, i) => ({ path: `${folder}/${names[i]}`, url: fileUrl(`${game.path}/${pak}`), size: game.sizes[i] }));
