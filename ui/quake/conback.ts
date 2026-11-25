import { fileUrl } from '@ein/ui/lib';
import { PAK_HEADER_SIZE, pakDirectory, pakEntries, type PakEntry } from '../../lib/paks.ts';
import { type Game, GAMES } from './games.ts';

/** Pictures already drawn, by game, paks and size: a game whose paks change draws again. */
const drawn = new Map<string, Promise<string | undefined>>();

/**
 * A game's console background as an image URL: its title art, the logo on the wall the console
 * drops over. Quake's is `gfx/conback.lmp`, drawn in `gfx/palette.lmp`'s colours; Quake 2's is
 * `pics/conback.pcx`, which has its colours in it. The last pak that has it is the one the game
 * uses, as with any file. Only the paks' directories and the files are fetched, with HTTP ranges.
 */
export function titlePicture(game: Game): Promise<string | undefined> {
  const key = `${game.name}:${game.paks.join(',')}:${game.size}`;
  let picture = drawn.get(key);
  if (!picture) {
    picture = draw(game).catch(() => undefined);
    drawn.set(key, picture);
  }
  return picture;
}

/** Bytes `start` to `start + length` of the file at `path`. */
async function range(path: string, start: number, length: number): Promise<Uint8Array> {
  const response = await fetch(fileUrl(path), { headers: { range: `bytes=${start}-${start + length - 1}` } });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A server that ignores the range sends the whole file.
  return response.status === 206 ? bytes : bytes.subarray(start, start + length);
}

type Entry = PakEntry & { path: string };

/** The files in the pak at `path`, each with the pak it is in. */
async function directory(path: string): Promise<Map<string, Entry>> {
  const where = pakDirectory(await range(path, 0, PAK_HEADER_SIZE));
  if (!where) return new Map();
  const entries = pakEntries(await range(path, where.offset, where.length));
  return new Map([...entries].map(([name, entry]) => [name, { ...entry, path }]));
}

async function draw(game: Game): Promise<string | undefined> {
  const dirs = await Promise.all(game.paks.map((pak) => directory(`${GAMES}/${game.name}/${pak}`)));
  const find = (name: string) => dirs.map((dir) => dir.get(name)).filter((entry) => entry !== undefined).at(-1);
  const read = (entry: Entry, size = entry.size) => range(entry.path, entry.at, size);
  if (game.engine === 'quake2') {
    const conback = find('pics/conback.pcx');
    return conback ? fromPcx(await read(conback)) : undefined;
  }
  const conback = find('gfx/conback.lmp');
  const palette = find('gfx/palette.lmp');
  if (!conback || !palette) return undefined;
  const [picture, colours] = await Promise.all([read(conback), read(palette, 768)]);
  const view = new DataView(picture.buffer, picture.byteOffset, picture.byteLength);
  return toImage(view.getInt32(0, true), view.getInt32(4, true), picture.subarray(8), colours);
}

/**
 * The pixels of a Quake 2 picture, a PCX of one 8-bit plane: a 128-byte header with its corners,
 * then each row run-length coded (a byte of 0xC0 and up repeats the next that many times, less
 * 0xC0), and at the end 0x0C and the palette's 768 bytes.
 */
function fromPcx(pcx: Uint8Array): string | undefined {
  if (pcx.length < 128 + 769 || pcx[0] !== 0x0a || pcx[3] !== 8 || pcx[65] !== 1 || pcx[pcx.length - 769] !== 0x0c) return undefined;
  const view = new DataView(pcx.buffer, pcx.byteOffset, pcx.byteLength);
  const width = view.getUint16(8, true) - view.getUint16(4, true) + 1;
  const height = view.getUint16(10, true) - view.getUint16(6, true) + 1;
  const stride = view.getUint16(66, true);
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
  return toImage(width, height, pixels, pcx.subarray(pcx.length - 768));
}

/** Draw a picture `width` by `height`: a palette index for each pixel, row by row, and the palette's red, green and blue. */
function toImage(width: number, height: number, pixels: Uint8Array, palette: Uint8Array): string | undefined {
  if (width <= 0 || height <= 0 || width > 1024 || height > 1024 || width * height > pixels.length) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const image = context.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const colour = pixels[i] * 3;
    image.data[i * 4] = palette[colour];
    image.data[i * 4 + 1] = palette[colour + 1];
    image.data[i * 4 + 2] = palette[colour + 2];
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
