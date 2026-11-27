/**
 * The titles of a game's maps, as the game itself shows them. Quake's and Quake II's are the
 * `message` of a map's first entity, the world (`worldspawn`), in its BSP's entities lump, which the
 * BSP's header says where to find: Quake's lump directory follows its version, Quake II's and Quake
 * 3's its `IBSP` and version. Quake 3's are the `longname` its arena scripts (`scripts/*.arena`,
 * `scripts/arenas.txt`) give each map, which its menus show.
 */

import type { Command } from '@ein/client';
import { openReader, type PakEntry } from './paks.ts';
import { type Pk3Entry, readPk3File } from './pk3.ts';

/** The most of an entities lump read for the world's: it is the first entity, a few lines. */
const WORLD_MAX = 4096;

/** Text in the games' own encoding as a person reads it: Quake's high half is its characters again in gold, line breaks are spaces, and it starts with a capital (`the Slipgate Complex`). */
function plain(bytes: Uint8Array): string {
  const text = String.fromCharCode(...bytes.map((byte) => byte & 0x7f)).replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Where a BSP's entities lump is, from its first 16 bytes; undefined for a file that is not a BSP. */
export function entitiesLump(header: Uint8Array): { offset: number; length: number } | undefined {
  if (header.length < 16) return undefined;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  // Quake II's and Quake 3's: IBSP, the version, then the lumps, the entities first.
  if (String.fromCharCode(...header.subarray(0, 4)) === 'IBSP') return { offset: view.getInt32(8, true), length: view.getInt32(12, true) };
  // Quake's: the version, 29 or a BSP2's, then the lumps.
  const version = view.getInt32(0, true);
  const bsp2 = ['BSP2', '2PSB'].includes(String.fromCharCode(...header.subarray(0, 4)));
  return version === 29 || bsp2 ? { offset: view.getInt32(4, true), length: view.getInt32(8, true) } : undefined;
}

/** The world's `message` in the start of an entities lump: the map's title; undefined when it has none. */
export function worldMessage(entities: Uint8Array): string | undefined {
  const world = new TextDecoder('latin1').decode(entities).split('}')[0];
  const message = /"message"\s+"([^"]*)"/i.exec(world)?.[1];
  const title = message === undefined ? '' : plain(Uint8Array.from(message, (character) => character.charCodeAt(0)));
  return title || undefined;
}

/** The title of the BSP at `at` in the file `read` reads from. */
async function bspTitle(read: (at: number, length: number) => Promise<Uint8Array>, at: number): Promise<string | undefined> {
  const lump = entitiesLump(await read(at, 16));
  if (!lump || lump.length <= 0) return undefined;
  return worldMessage(await read(at + lump.offset, Math.min(lump.length, WORLD_MAX)));
}

/**
 * The titles of the maps of a Quake or Quake II game, by their names in lower case: those in its paks, a later
 * pak's over an earlier's as the engine loads them, and the maps in its folder's `maps/` (`loose`,
 * paths in the folder `folder`) over them.
 */
export async function bspTitles(cmd: Command, paks: { path: string; files: Map<string, PakEntry> }[], folder: string, loose: string[]): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  const mapName = (path: string) => /^maps\/([^/]+)\.bsp$/i.exec(path)?.[1].toLowerCase();
  for (const pak of paks) {
    const maps = [...pak.files.values()].filter((entry) => mapName(entry.name));
    if (maps.length === 0) continue;
    const reader = await openReader(cmd, pak.path);
    try {
      for (const entry of maps) {
        const title = await bspTitle(reader.read, entry.at).catch(() => undefined);
        if (title) titles[mapName(entry.name)!] = title;
      }
    } finally {
      await reader.close();
    }
  }
  for (const file of loose.filter(mapName)) {
    const reader = await openReader(cmd, `${folder}/${file}`).catch(() => undefined);
    if (!reader) continue;
    try {
      const title = await bspTitle(reader.read, 0).catch(() => undefined);
      if (title) titles[mapName(file)!] = title;
    } finally {
      await reader.close();
    }
  }
  return titles;
}

/** Each map's `longname` in the text of arena scripts: `{ map "q3dm1" longname "Arena Gate" … }`, by the map's name in lower case. */
export function arenaLongnames(text: string): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const [, block] of text.matchAll(/\{([^}]*)\}/g)) {
    const map = /\bmap\s+"([^"]+)"/i.exec(block)?.[1];
    const longname = /\blongname\s+"([^"]+)"/i.exec(block)?.[1];
    if (map && longname) titles[map.toLowerCase()] = longname.replace(/\s+/g, ' ').trim();
  }
  return titles;
}

/** The titles of the maps of a Quake 3 game, from the arena scripts in its pk3s, a later pk3's over an earlier's. */
export async function arenaTitles(cmd: Command, pk3s: { path: string; files: Map<string, Pk3Entry> }[]): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  for (const pk3 of pk3s) {
    for (const [name, entry] of pk3.files) {
      if (!/^scripts\/([^/]+\.arena|arenas\.txt)$/.test(name)) continue;
      const text = await readPk3File(cmd, pk3.path, entry).then((bytes) => new TextDecoder('latin1').decode(bytes), () => '');
      Object.assign(titles, arenaLongnames(text));
    }
  }
  return titles;
}
