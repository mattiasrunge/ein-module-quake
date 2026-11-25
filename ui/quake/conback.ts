import { fileUrl } from '@ein/ui/lib';
import { type Game, GAMES } from './games.ts';

/** Pictures already drawn, by game, paks and size: a game whose paks change draws again. */
const drawn = new Map<string, Promise<string | undefined>>();

/**
 * A game's console background, `gfx/conback.lmp`, as an image URL: Quake's title art, its logo on
 * the wall the console drops over. The last pak that has it is the one Quake uses, as with any
 * file. Only the paks' directories and the two files are fetched, with HTTP ranges.
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

type Entry = { path: string; at: number; size: number };

/**
 * The files in a pak: a `PACK` header with its directory's offset and length, the directory 64
 * bytes an entry, each a name of up to 56 bytes, the file's offset and its length.
 */
async function directory(path: string): Promise<Map<string, Entry>> {
  const header = await range(path, 0, 12);
  if (String.fromCharCode(...header.subarray(0, 4)) !== 'PACK') return new Map();
  const view = new DataView(header.buffer, header.byteOffset, 12);
  const offset = view.getInt32(4, true);
  const length = view.getInt32(8, true);
  const entries = await range(path, offset, length);
  const entryView = new DataView(entries.buffer, entries.byteOffset, entries.byteLength);
  const files = new Map<string, Entry>();
  for (let i = 0; i + 64 <= length; i += 64) {
    const name = String.fromCharCode(...entries.subarray(i, i + 56)).replace(/\0.*$/s, '').toLowerCase();
    files.set(name, { path, at: entryView.getInt32(i + 56, true), size: entryView.getInt32(i + 60, true) });
  }
  return files;
}

async function draw(game: Game): Promise<string | undefined> {
  const dirs = await Promise.all(game.paks.map((pak) => directory(`${GAMES}/${game.name}/${pak}`)));
  const find = (name: string) => dirs.map((dir) => dir.get(name)).filter((entry) => entry !== undefined).at(-1);
  const conback = find('gfx/conback.lmp');
  const palette = find('gfx/palette.lmp');
  if (!conback || !palette) return undefined;
  const [picture, colours] = await Promise.all([range(conback.path, conback.at, conback.size), range(palette.path, palette.at, 768)]);
  return toImage(picture, colours);
}

/** Draw a Quake picture: its width and height as 32-bit words, then a palette index for each pixel, row by row. */
function toImage(picture: Uint8Array, palette: Uint8Array): string | undefined {
  const view = new DataView(picture.buffer, picture.byteOffset, picture.byteLength);
  const width = view.getInt32(0, true);
  const height = view.getInt32(4, true);
  if (width <= 0 || height <= 0 || width > 1024 || height > 1024 || 8 + width * height > picture.length) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const image = context.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const colour = picture[8 + i] * 3;
    image.data[i * 4] = palette[colour];
    image.data[i * 4 + 1] = palette[colour + 1];
    image.data[i * 4 + 2] = palette[colour + 2];
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
