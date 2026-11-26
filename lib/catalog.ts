import type { Command, NodeAttrs } from '@ein/client';
import type { Game } from './api.ts';
import { byRank, DATA_FOLDERS, engineOf, GAMES, mapsOf, PAK_FILE, titleOf, tracksOf } from './games.ts';
import { PAK_HEADER_SIZE, pakDirectory, type PakEntry, pakEntries } from './paks.ts';

/** Seek from the start of the file: core's `ResourceSeekMode.Start`, which `@ein/client` does not export. */
const SEEK_START = 0;

/** A file open to read pieces of: `read` answers `length` bytes from `at` on, fewer when the file ends sooner. */
export type Reader = { read(at: number, length: number): Promise<Uint8Array>; close(): Promise<void> };

/** Open the file at `path` to read pieces of it. */
export async function openReader(cmd: Command, path: string): Promise<Reader> {
  const handle = await cmd.sys.vfs.open(cmd.access, path, { mode: 'r' });
  return {
    async read(at, length) {
      await handle.seek(at, SEEK_START);
      const bytes = new Uint8Array(length);
      let filled = 0;
      while (filled < length) {
        const chunk = await handle.read(length - filled);
        if (chunk.length === 0) break;
        bytes.set(chunk, filled);
        filled += chunk.length;
      }
      return bytes.subarray(0, filled);
    },
    close: () => handle.close(),
  };
}

/** `length` bytes of the file at `path` from `at` on, fewer when it ends sooner. */
export async function readRange(cmd: Command, path: string, at: number, length: number): Promise<Uint8Array> {
  const reader = await openReader(cmd, path);
  try {
    return await reader.read(at, length);
  } finally {
    await reader.close();
  }
}

/** The whole file at `path`. */
export async function readWhole(cmd: Command, path: string): Promise<Uint8Array> {
  const size = (await cmd.sys.vfs.get<NodeAttrs & { size?: number }>(cmd.access, path)).attrs.size ?? 0;
  return await readRange(cmd, path, 0, size);
}

/** The files in the pak at `path`, by their lower-case paths: only its header and directory are read. */
export async function pakFiles(cmd: Command, path: string): Promise<Map<string, PakEntry>> {
  const reader = await openReader(cmd, path);
  try {
    const directory = pakDirectory(await reader.read(0, PAK_HEADER_SIZE));
    return directory ? pakEntries(await reader.read(directory.offset, directory.length)) : new Map();
  } finally {
    await reader.close();
  }
}

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

/** The games in `GAMES`, as `quake-games` lists them: id's games first. */
export async function findGames(cmd: Command): Promise<Game[]> {
  const vfs = cmd.sys.vfs;
  const names = async (path: string) => (await vfs.exists(cmd.access, path)) ? (await vfs.children(cmd.access, path)).map((child) => child.name) : [];
  // A folder's tracks, or none when it has none.
  const musicIn = async (folder: string) => {
    const tracks = tracksOf(await names(folder));
    return Object.keys(tracks).length > 0 ? { folder, tracks } : undefined;
  };

  const games: Game[] = [];
  // No folder yet is no games yet: the page makes it, and the services fill it.
  for (const name of await names(GAMES)) {
    if (name.startsWith('.')) continue;
    const node = await vfs.get(cmd.access, `${GAMES}/${name}`).catch(() => undefined);
    if (node?.type !== 'directory') continue;
    // Quake and Quake 2 load pak0, pak1 and on, and stop at the first number missing.
    const found = new Map<number, string>();
    const folders: string[] = [];
    for (const child of await vfs.children(cmd.access, `${GAMES}/${name}`)) {
      const match = PAK_FILE.exec(child.name);
      if (match) found.set(Number(match[1]), child.name);
      if (child.node.type === 'directory' && DATA_FOLDERS.includes(child.name.toLowerCase())) folders.push(child.name);
    }
    const paks: string[] = [];
    while (found.has(paks.length)) paks.push(found.get(paks.length)!);
    if (paks.length === 0) continue;
    const sizes = await Promise.all(paks.map(async (pak) => (await vfs.get<NodeAttrs & { size?: number }>(cmd.access, `${GAMES}/${name}/${pak}`)).attrs.size ?? 0));
    // What the paks hold says which game it is; a pak that cannot be read says nothing.
    const files = new Set((await Promise.all(paks.map(async (pak) => [...(await pakFiles(cmd, `${GAMES}/${name}/${pak}`).catch(() => new Map())).keys()]))).flat());
    const music = await musicIn(`${GAMES}/${name}/music`);
    games.push({
      name,
      title: titleOf(name, sizes, files),
      engine: engineOf(files),
      paks,
      size: sizes.reduce((sum, size) => sum + size, 0),
      files: (await Promise.all(folders.map((folder) => filesUnder(cmd, `${GAMES}/${name}/${folder}`, `${folder}/`)))).flat(),
      maps: mapsOf(files),
      ...(music ? { music } : {}),
    });
  }
  return games.sort(byRank);
}
