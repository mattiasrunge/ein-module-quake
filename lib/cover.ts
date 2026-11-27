import type { Command } from '@ein/client';
import { pngDataUrl } from '@games/png';
import type { EngineName } from './api.ts';
import { openReader, type PakEntry } from './paks.ts';

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
