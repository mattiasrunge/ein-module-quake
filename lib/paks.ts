/**
 * A pak, Quake's and Quake 2's alike: a 12-byte header, `PACK` and the directory's offset and
 * length; then, where the header says, the directory, 64 bytes an entry, each a name of up to 56
 * bytes, the file's offset and its length. Read by the page in the browser and by `quake-games`
 * in EiN, each fetching only the bytes it needs.
 */

/** The bytes a pak's header takes. */
export const PAK_HEADER_SIZE = 12;

/** Where a file's bytes are in its pak, and its path there as the pak spells it. */
export type PakEntry = { name: string; at: number; size: number };

/** Where the directory is, from a pak's first `PAK_HEADER_SIZE` bytes; undefined for a file that is not a pak. */
export function pakDirectory(header: Uint8Array): { offset: number; length: number } | undefined {
  if (header.length < PAK_HEADER_SIZE || String.fromCharCode(...header.subarray(0, 4)) !== 'PACK') return undefined;
  const view = new DataView(header.buffer, header.byteOffset, PAK_HEADER_SIZE);
  return { offset: view.getInt32(4, true), length: view.getInt32(8, true) };
}

/** The files a directory lists, by their path in lower case. */
export function pakEntries(directory: Uint8Array): Map<string, PakEntry> {
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const files = new Map<string, PakEntry>();
  for (let i = 0; i + 64 <= directory.length; i += 64) {
    const name = String.fromCharCode(...directory.subarray(i, i + 56)).replace(/\0.*$/s, '');
    files.set(name.toLowerCase(), { name, at: view.getInt32(i + 56, true), size: view.getInt32(i + 60, true) });
  }
  return files;
}

/** A pak of `files`, each under its path as given: the header, the files' bytes one after the other, then the directory. */
export function packPak(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const size = files.reduce((sum, file) => sum + file.data.length, 0);
  const pak = new Uint8Array(PAK_HEADER_SIZE + size + files.length * 64);
  const view = new DataView(pak.buffer);
  pak.set([0x50, 0x41, 0x43, 0x4b]);
  view.setInt32(4, PAK_HEADER_SIZE + size, true);
  view.setInt32(8, files.length * 64, true);
  let at = PAK_HEADER_SIZE;
  let entry = PAK_HEADER_SIZE + size;
  for (const file of files) {
    pak.set(file.data, at);
    pak.set(new TextEncoder().encode(file.name.slice(0, 55)), entry);
    view.setInt32(entry + 56, at, true);
    view.setInt32(entry + 60, file.data.length, true);
    at += file.data.length;
    entry += 64;
  }
  return pak;
}
