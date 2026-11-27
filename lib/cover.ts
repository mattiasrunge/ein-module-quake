import type { Command } from '@ein/client';
import { pngDataUrl } from '@games/png';
import type { EngineName } from './api.ts';
import { openReader, type PakEntry } from './paks.ts';
import { type Pk3Entry, readPk3File } from './pk3.ts';

/** The widest a cover is: a picture twice as wide, as Quake II's 640 by 480 is, is drawn at half its size. */
const COVER_WIDTH = 320;

/**
 * A game's title art as a PNG `data:` URL: its console background, the logo on the wall the console
 * drops over. Quake's is `gfx/conback.lmp`, drawn in `gfx/palette.lmp`'s colours; Quake II's is
 * `pics/conback.pcx`, which has its colours in it. `paks` are the game's paks in the order the
 * engine loads them, each by its path with its files (`pakFiles`); the last that has the picture is
 * the one the game uses, as with any file. Only the picture's bytes are read. Undefined when the
 * paks have no such picture.
 */
export async function coverOf(cmd: Command, engine: EngineName, paks: { path: string; files: Map<string, PakEntry> }[]): Promise<string | undefined> {
  const find = (name: string) => paks.map(({ path, files }) => files.has(name) ? { ...files.get(name)!, path } : undefined).filter((entry) => entry !== undefined).at(-1);
  const read = async (entry: PakEntry & { path: string }, size = entry.size) => {
    const reader = await openReader(cmd, entry.path);
    try {
      return await reader.read(entry.at, size);
    } finally {
      await reader.close();
    }
  };
  if (engine === 'quake2') {
    const conback = find('pics/conback.pcx');
    return conback ? fromPcx(await read(conback)) : undefined;
  }
  const conback = find('gfx/conback.lmp');
  const palette = find('gfx/palette.lmp');
  if (!conback || !palette) return undefined;
  const [picture, colours] = await Promise.all([read(conback), read(palette, 768)]);
  if (picture.length < 8) return undefined;
  const view = new DataView(picture.buffer, picture.byteOffset, picture.byteLength);
  return await toPng(view.getInt32(0, true), view.getInt32(4, true), picture.subarray(8), colours);
}

/** The arenas whose levelshot is a Quake 3 game's cover when it has them: OpenArena's first, id's first. */
const COVER_MAPS = ['oa_dm1', 'q3dm1'];

/**
 * A Quake 3 game's title art as a JPEG `data:` URL: the levelshot of one of its arenas, the picture
 * its menus show of it, of `COVER_MAPS`' first it has, else of its first of `maps` with a JPEG one
 * (`levelshots/<map>.jpg`). `pk3s` are the game's pk3s in the order the engine loads them, each by
 * its path with its files (`pk3Files`); the last that has the picture is the one the game uses.
 * Only the picture's bytes are read. Undefined when none of its arenas has a JPEG levelshot.
 */
export async function quake3CoverOf(cmd: Command, pk3s: { path: string; files: Map<string, Pk3Entry> }[], maps: string[]): Promise<string | undefined> {
  const find = (name: string) => pk3s.filter(({ files }) => files.has(name)).map(({ path, files }) => ({ path, entry: files.get(name)! })).at(-1);
  const ordered = [...COVER_MAPS.filter((map) => maps.includes(map)), ...maps];
  const shot = ordered.map((map) => find(`levelshots/${map.toLowerCase()}.jpg`)).find((found) => found !== undefined);
  if (!shot) return undefined;
  const bytes = await readPk3File(cmd, shot.path, shot.entry);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/**
 * The picture of a Quake II PCX of one 8-bit plane: a 128-byte header with its corners, then each
 * row run-length coded (a byte of 0xC0 and up repeats the next that many times, less 0xC0), and at
 * the end 0x0C and the palette's 768 bytes.
 */
async function fromPcx(pcx: Uint8Array): Promise<string | undefined> {
  if (pcx.length < 128 + 769 || pcx[0] !== 0x0a || pcx[3] !== 8 || pcx[65] !== 1 || pcx[pcx.length - 769] !== 0x0c) return undefined;
  const view = new DataView(pcx.buffer, pcx.byteOffset, pcx.byteLength);
  const width = view.getUint16(8, true) - view.getUint16(4, true) + 1;
  const height = view.getUint16(10, true) - view.getUint16(6, true) + 1;
  const stride = view.getUint16(66, true);
  if (width <= 0 || height <= 0 || width > 1024 || height > 1024) return undefined;
  const pixels = new Uint8Array(width * height);
  let at = 128;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < stride;) {
      let count = 1;
      let value = pcx[at++];
      if (value >= 0xc0) {
        count = value - 0xc0;
        value = pcx[at++];
      }
      for (; count > 0 && x < stride; count--, x++) if (x < width) pixels[y * width + x] = value;
    }
  }
  return await toPng(width, height, pixels, pcx.subarray(pcx.length - 768));
}

/**
 * The picture `width` by `height`, a palette index for each pixel row by row and the palette's red,
 * green and blue, as a PNG: every pixel, or every second of every second row when it is wider than
 * a cover.
 */
async function toPng(width: number, height: number, pixels: Uint8Array, palette: Uint8Array): Promise<string | undefined> {
  if (width <= 0 || height <= 0 || width > 1024 || height > 1024 || width * height > pixels.length) return undefined;
  const step = Math.max(1, Math.floor(width / COVER_WIDTH));
  const shownWidth = Math.floor(width / step);
  const shownHeight = Math.floor(height / step);
  const rgba = new Uint8Array(shownWidth * shownHeight * 4);
  for (let y = 0; y < shownHeight; y++) {
    for (let x = 0; x < shownWidth; x++) {
      const colour = pixels[y * step * width + x * step] * 3;
      const at = (y * shownWidth + x) * 4;
      rgba[at] = palette[colour];
      rgba[at + 1] = palette[colour + 1];
      rgba[at + 2] = palette[colour + 2];
      rgba[at + 3] = 255;
    }
  }
  return await pngDataUrl(shownWidth, shownHeight, rgba);
}
