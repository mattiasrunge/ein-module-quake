/**
 * A pk3, Quake 3's pak: a zip file. At its end the end of central directory record says where the
 * central directory is; each of the directory's entries names a file, says how it is stored (0 as
 * it is, 8 deflated), its sizes, and where its local header is, which its bytes follow. The
 * commands read only the bytes they need of one.
 */

import type { Command, NodeAttrs } from '@ein/client';
import { openReader } from './paks.ts';

/** A file in a pk3: its path as the pk3 spells it, how it is stored, its sizes, and its central directory entry's bytes. */
export type Pk3Entry = { name: string; method: number; packed: number; size: number; at: number; entry: Uint8Array };

/** The longest the end of central directory record is: 22 bytes and a comment of up to 65535. */
const END_MAX = 22 + 65535;

/** A pk3 open to read pieces of: the file's size and a reader. */
type Pk3 = { size: number; read(at: number, length: number): Promise<Uint8Array>; close(): Promise<void> };

/** Open the pk3 at `path`. */
async function openPk3(cmd: Command, path: string): Promise<Pk3> {
  const size = (await cmd.sys.vfs.get<NodeAttrs & { size?: number }>(cmd.access, path)).attrs.size ?? 0;
  return { size, ...await openReader(cmd, path) };
}

/** The files in an open pk3, by their lower-case paths; none when it is not a zip file. */
async function entriesOf(pk3: Pk3): Promise<Map<string, Pk3Entry>> {
  const files = new Map<string, Pk3Entry>();
  const tail = await pk3.read(Math.max(0, pk3.size - END_MAX), Math.min(pk3.size, END_MAX));
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = -1;
  for (let i = tail.length - 22; i >= 0 && end < 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) end = i;
  }
  if (end < 0) return files;
  const directory = await pk3.read(view.getUint32(end + 16, true), view.getUint32(end + 12, true));
  const entries = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  for (let i = 0; i + 46 <= directory.length && entries.getUint32(i, true) === 0x02014b50;) {
    const nameLength = entries.getUint16(i + 28, true);
    const size = 46 + nameLength + entries.getUint16(i + 30, true) + entries.getUint16(i + 32, true);
    const name = new TextDecoder().decode(directory.subarray(i + 46, i + 46 + nameLength));
    if (!name.endsWith('/')) {
      files.set(name.toLowerCase(), {
        name,
        method: entries.getUint16(i + 10, true),
        packed: entries.getUint32(i + 20, true),
        size: entries.getUint32(i + 24, true),
        at: entries.getUint32(i + 42, true),
        entry: directory.subarray(i, i + size),
      });
    }
    i += size;
  }
  return files;
}

/** The files in the pk3 at `path`, by their lower-case paths: only its end and its central directory are read. */
export async function pk3Files(cmd: Command, path: string): Promise<Map<string, Pk3Entry>> {
  const pk3 = await openPk3(cmd, path);
  try {
    return await entriesOf(pk3);
  } finally {
    await pk3.close();
  }
}

/** Where an entry's local header ends and its bytes start, from the header's first 30 bytes. */
function dataAt(entry: Pk3Entry, header: Uint8Array): number {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return entry.at + 30 + view.getUint16(26, true) + view.getUint16(28, true);
}

/** The bytes of `entry`, a file of the pk3 at `path`, unpacked. */
export async function readPk3File(cmd: Command, path: string, entry: Pk3Entry): Promise<Uint8Array> {
  const pk3 = await openPk3(cmd, path);
  try {
    const packed = await pk3.read(dataAt(entry, await pk3.read(entry.at, 30)), entry.packed);
    if (entry.method === 0) return packed;
    if (entry.method !== 8) throw new Error(`${entry.name} is packed in a way pk3s are not (${entry.method})`);
    const stream = new Blob([packed as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } finally {
    await pk3.close();
  }
}

/**
 * The pk3 at `path` with only the files `keep` takes, by their lower-case paths, as a zip of its
 * own: each kept file's local header and bytes as they are, unpacked or not, then a central
 * directory of their entries.
 */
export async function trimPk3(cmd: Command, path: string, keep: (name: string) => boolean): Promise<Uint8Array> {
  const pk3 = await openPk3(cmd, path);
  try {
    const kept = [...(await entriesOf(pk3)).entries()].filter(([name]) => keep(name)).map(([, entry]) => entry);
    const locals: Uint8Array[] = [];
    const directory: Uint8Array[] = [];
    let at = 0;
    for (const entry of kept) {
      const local = await pk3.read(entry.at, dataAt(entry, await pk3.read(entry.at, 30)) - entry.at + entry.packed);
      const central = entry.entry.slice();
      new DataView(central.buffer).setUint32(42, at, true);
      locals.push(local);
      directory.push(central);
      at += local.length;
    }
    const directorySize = directory.reduce((sum, bytes) => sum + bytes.length, 0);
    const zip = new Uint8Array(at + directorySize + 22);
    let offset = 0;
    for (const bytes of [...locals, ...directory]) {
      zip.set(bytes, offset);
      offset += bytes.length;
    }
    const end = new DataView(zip.buffer, offset, 22);
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, kept.length, true);
    end.setUint16(10, kept.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, at, true);
    return zip;
  } finally {
    await pk3.close();
  }
}
