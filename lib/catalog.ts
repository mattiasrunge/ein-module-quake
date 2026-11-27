import type { Command, NodeAttrs } from '@ein/client';
import type { Game, InstalledGame } from './api.ts';
import { coverOf } from './cover.ts';
import { byRank, DATA_FOLDERS, ENGINE_TITLES, engineOf, GAMES, mapsOf, OFFERS, PAK_FILE, titleOf, tracksOf } from './games.ts';
import { type PakEntry, pakFiles } from './paks.ts';

/** The files in the folder `path` and in its folders, by their paths in it. */
async function filesUnder(cmd: Command, path: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const child of await cmd.sys.vfs.children(cmd.access, path).catch(() => [])) {
    const name = `${prefix}${child.name}`;
    if (child.node.type === 'directory') found.push(...await filesUnder(cmd, `${path}/${child.name}`, `${name}/`));
    else found.push(name);
  }
  return found;
}

/**
 * What the engine reads of the game in the folder `folder`: its paks, in the order the engine loads
 * them, and the files beside them in the folders it reads as it reads a pak's (`DATA_FOLDERS`), by
 * their paths in it. No paks is no game.
 */
export async function gameFiles(cmd: Command, folder: string): Promise<{ paks: string[]; files: string[] }> {
  // Quake and Quake II load pak0, pak1 and on, and stop at the first number missing.
  const found = new Map<number, string>();
  const folders: string[] = [];
  for (const child of await cmd.sys.vfs.children(cmd.access, folder)) {
    const match = PAK_FILE.exec(child.name);
    if (match && child.node.type !== 'directory') found.set(Number(match[1]), child.name);
    if (child.node.type === 'directory' && DATA_FOLDERS.includes(child.name.toLowerCase())) folders.push(child.name);
  }
  const paks: string[] = [];
  while (found.has(paks.length)) paks.push(found.get(paks.length)!);
  const files = (await Promise.all(folders.map((name) => filesUnder(cmd, `${folder}/${name}`, `${name}/`)))).flat();
  return { paks, files };
}

/** `bytes` as a person reads a size: `18 MB`. */
const sizeText = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`;

/** The game in the folder `name` of `GAMES`, as `quake-games` lists it; undefined when it is no game, a folder without paks. */
async function readGame(cmd: Command, name: string): Promise<InstalledGame | undefined> {
  const vfs = cmd.sys.vfs;
  const path = `${GAMES}/${name}`;
  const { paks, files } = await gameFiles(cmd, path);
  if (paks.length === 0) return undefined;
  const sizes = await Promise.all(paks.map(async (pak) => (await vfs.get<NodeAttrs & { size?: number }>(cmd.access, `${path}/${pak}`)).attrs.size ?? 0));
  // What the paks hold says which game it is; a pak that cannot be read says nothing.
  const read = await Promise.all(paks.map(async (pak) => ({ path: `${path}/${pak}`, files: await pakFiles(cmd, `${path}/${pak}`).catch(() => new Map<string, PakEntry>()) })));
  const inPaks = new Set(read.flatMap(({ files }) => [...files.keys()]));
  const engine = engineOf(inPaks);
  const size = sizes.reduce((sum, each) => sum + each, 0);
  const musicFolder = `${path}/music`;
  const tracks = tracksOf((await vfs.children(cmd.access, musicFolder).catch(() => [])).map((child) => child.name));
  const music = Object.keys(tracks).length > 0 ? { folder: musicFolder, tracks } : undefined;
  // Quake's shareware episode reads no file in a folder but from its paks (it is registered when its
  // paks have `gfx/pop.lmp`), so its own maps are those of its paks alone.
  const loose = engine === 'quake2' || inPaks.has('gfx/pop.lmp');
  const maps = mapsOf(loose ? [...inPaks, ...files] : inPaks);
  const cover = await coverOf(cmd, engine, read).catch(() => undefined);
  return {
    id: name,
    title: titleOf(name, sizes, inPaks),
    state: 'installed',
    family: engine,
    path,
    detail: `${ENGINE_TITLES[engine]} · ${sizeText(size)} · ${music ? 'music' : 'no music'}`,
    ...(cover ? { cover } : {}),
    paks,
    size,
    files,
    maps,
    hostable: maps.length > 0,
    // A map dropped for the shareware episode could never be played.
    ...(loose ? {} : { sealed: true }),
    ...(music ? { music } : {}),
  };
}

/**
 * The games in `GAMES`, id's first, then the free games the module offers whose folders are not
 * there, as `quake-games` lists them.
 */
export async function findGames(cmd: Command): Promise<Game[]> {
  // No folder yet is no games yet: a fetch or a drop makes it.
  const children = await cmd.sys.vfs.children(cmd.access, GAMES).catch(() => []);
  const folders = children.filter((child) => child.node.type === 'directory' && !child.name.startsWith('.')).map((child) => child.name);
  const installed = (await Promise.all(folders.map((name) => readGame(cmd, name)))).filter((game) => game !== undefined).sort(byRank);
  return [...installed, ...OFFERS.filter((offer) => !folders.includes(offer.id))];
}
