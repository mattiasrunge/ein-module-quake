import type { Command, NodeAttrs } from '@ein/client';
import type { EngineName, Game, InstalledGame } from './api.ts';
import { coverOf, quake3CoverOf } from './cover.ts';
import {
  byRank,
  DATA_FOLDERS,
  descriptionOf,
  ENGINE_TITLES,
  engineOf,
  gamedirOf,
  GAMES,
  mapsOf,
  OFFERS,
  PAK_FILE,
  PK3_FILE,
  QUAKE3_FOLDERS,
  titleOf,
  tracksOf,
} from './games.ts';
import { arenaTitles, bspTitles } from './maps.ts';
import { type PakEntry, pakFiles } from './paks.ts';
import { type Pk3Entry, pk3Files } from './pk3.ts';

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
 * them, and the files beside them in the folders it reads as it reads a pak's (`DATA_FOLDERS`, and
 * Quake 3's `QUAKE3_FOLDERS`), by their paths in it; whether it is a Quake 3 game, one with pk3s
 * and no `pak0.pak`. No paks is no game.
 */
export async function gameFiles(cmd: Command, folder: string): Promise<{ paks: string[]; files: string[]; quake3: boolean }> {
  // Quake and Quake II load pak0, pak1 and on, and stop at the first number missing; Quake 3 loads
  // every pk3 there is.
  const found = new Map<number, string>();
  const pk3s: string[] = [];
  const folders: string[] = [];
  const children = await cmd.sys.vfs.children(cmd.access, folder);
  for (const child of children) {
    const match = PAK_FILE.exec(child.name);
    if (match && child.node.type !== 'directory') found.set(Number(match[1]), child.name);
    if (PK3_FILE.test(child.name) && child.node.type !== 'directory') pk3s.push(child.name);
  }
  const quake3 = !found.has(0) && pk3s.length > 0;
  const read = quake3 ? [...DATA_FOLDERS, ...QUAKE3_FOLDERS] : DATA_FOLDERS;
  for (const child of children) {
    if (child.node.type === 'directory' && read.includes(child.name.toLowerCase())) folders.push(child.name);
  }
  const paks: string[] = [];
  if (quake3) paks.push(...pk3s.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  else while (found.has(paks.length)) paks.push(found.get(paks.length)!);
  const files = (await Promise.all(folders.map((name) => filesUnder(cmd, `${folder}/${name}`, `${name}/`)))).flat();
  return { paks, files, quake3 };
}

/** `bytes` as a person reads a size: `18 MB`. */
const sizeText = (bytes: number): string =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`;

/** The game in the folder `name` of `GAMES`, as `quake-games` lists it; undefined when it is no game, a folder without paks. */
async function readGame(cmd: Command, name: string): Promise<InstalledGame | undefined> {
  const vfs = cmd.sys.vfs;
  const path = `${GAMES}/${name}`;
  const { paks, files, quake3 } = await gameFiles(cmd, path);
  if (paks.length === 0) return undefined;
  const sizes = await Promise.all(paks.map(async (pak) => (await vfs.get<NodeAttrs & { size?: number }>(cmd.access, `${path}/${pak}`)).attrs.size ?? 0));
  // What the paks hold says which game it is; a pak that cannot be read says nothing.
  const read = quake3
    ? []
    : await Promise.all(paks.map(async (pak) => ({ path: `${path}/${pak}`, files: await pakFiles(cmd, `${path}/${pak}`).catch(() => new Map<string, PakEntry>()) })));
  const zipped = quake3
    ? await Promise.all(paks.map(async (pak) => ({ path: `${path}/${pak}`, files: await pk3Files(cmd, `${path}/${pak}`).catch(() => new Map<string, Pk3Entry>()) })))
    : [];
  const inPaks = new Set([...read, ...zipped].flatMap(({ files }) => [...files.keys()]));
  const engine: EngineName = quake3 ? 'quake3' : engineOf(inPaks);
  const size = sizes.reduce((sum, each) => sum + each, 0);
  // Quake 3's music is files it plays, in its pk3s or beside them; Quake's and Quake II's a CD's tracks.
  const musicFolder = `${path}/music`;
  const tracks = quake3 ? {} : tracksOf((await vfs.children(cmd.access, musicFolder).catch(() => [])).map((child) => child.name));
  const music = Object.keys(tracks).length > 0 ? { folder: musicFolder, tracks } : undefined;
  // Quake's shareware episode reads no file in a folder but from its paks (it is registered when its
  // paks have `gfx/pop.lmp`), so its own maps are those of its paks alone.
  const loose = engine !== 'quake' || inPaks.has('gfx/pop.lmp');
  const maps = mapsOf(loose ? [...inPaks, ...files] : inPaks);
  const titled = await (quake3 ? arenaTitles(cmd, zipped) : bspTitles(cmd, read, path, loose ? files : [])).catch(() => ({} as Record<string, string>));
  const mapTitles = Object.fromEntries(maps.filter((map) => titled[map.toLowerCase()]).map((map) => [map, titled[map.toLowerCase()]]));
  const title = titleOf(name, engine, sizes, inPaks);
  const cover = await (quake3 ? quake3CoverOf(cmd, zipped, maps) : coverOf(cmd, engine, read)).catch(() => undefined);
  const description = descriptionOf(title);
  return {
    id: name,
    title,
    state: 'installed',
    family: engine,
    path,
    detail: quake3 ? `${ENGINE_TITLES[engine]} · ${sizeText(size)} · ${maps.length} maps` : `${ENGINE_TITLES[engine]} · ${sizeText(size)} · ${music ? 'music' : 'no music'}`,
    ...(description ? { description } : {}),
    ...(cover ? { cover } : {}),
    paks,
    ...(quake3 ? { gamedir: gamedirOf(name, title) } : {}),
    size,
    sizes,
    files,
    maps,
    ...(Object.keys(mapTitles).length > 0 ? { mapTitles } : {}),
    hostable: maps.length > 0,
    // A map dropped for the shareware episode could never be played.
    ...(loose ? {} : { sealed: true }),
    ...(music ? { music } : {}),
  };
}

/**
 * The games in `GAMES`, id's first, then the free games the module offers whose folders are not
 * there, as `quake-games` lists them. With `only`, a game's folder in `GAMES`, that game alone, or
 * none when it is no game: what someone who opened a share link to it reads, who may not list `GAMES`.
 */
export async function findGames(cmd: Command, only?: string): Promise<Game[]> {
  if (only !== undefined) {
    const name = only.slice(GAMES.length + 1);
    if (!only.startsWith(`${GAMES}/`) || !name || name.includes('/') || name.startsWith('.')) return [];
    const game = await readGame(cmd, name).catch(() => undefined);
    return game ? [game] : [];
  }
  // No folder yet is no games yet: a fetch or a drop makes it.
  const children = await cmd.sys.vfs.children(cmd.access, GAMES).catch(() => []);
  const folders = children.filter((child) => child.node.type === 'directory' && !child.name.startsWith('.')).map((child) => child.name);
  const installed = (await Promise.all(folders.map((name) => readGame(cmd, name)))).filter((game) => game !== undefined).sort(byRank);
  return [...installed, ...OFFERS.filter((offer) => !folders.includes(offer.id))];
}
