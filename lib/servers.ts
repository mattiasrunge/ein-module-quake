import type { Command } from '@ein/client';
import type { Seat, ServerInfo } from './api.ts';
import { readWhole } from './catalog.ts';
import { SERVERS } from './games.ts';
import { SERVER_ADDRESS } from './net.ts';

/** A server's folder. */
export const serverPath = (id: string): string => `${SERVERS}/${id}`;

/** A server's `server.json`. */
export const serverFile = (id: string): string => `${serverPath(id)}/server.json`;

/** A server's seats: a folder each, made by whoever takes it. */
export const seatsPath = (id: string): string => `${serverPath(id)}/players`;

/** A seat's folder, and its two streams: `in`, which the player writes and the server reads, and `out`, which the server writes and the player reads. */
export const seatPath = (id: string, seat: string): string => `${seatsPath(id)}/${seat}`;
export const seatIn = (id: string, seat: string): string => `${seatPath(id, seat)}/in`;
export const seatOut = (id: string, seat: string): string => `${seatPath(id, seat)}/out`;

/** Sticky and open to every account, as `/tmp` is: anyone makes a folder in it, and only its owner (or the administrator) removes it. */
export const SHARED_FOLDER_MODE = 0o1777;

/** A server's `server.json`, or undefined when it is not there or cannot be read. */
export async function readServer(cmd: Command, id: string): Promise<ServerInfo | undefined> {
  try {
    return JSON.parse(new TextDecoder().decode(await readWhole(cmd, serverFile(id)))) as ServerInfo;
  } catch {
    return undefined;
  }
}

/** Write a server's `server.json`, made when it is not there yet. */
export async function writeServer(cmd: Command, info: ServerInfo): Promise<void> {
  const vfs = cmd.sys.vfs;
  await vfs.ensure(cmd.access, 'file', serverPath(info.id), 'server.json', { props: { tier: 'db', mode: 0o644 }, attrs: { mimetype: 'application/json' } });
  const handle = await vfs.open(cmd.access, serverFile(info.id), { mode: 'w' });
  try {
    await handle.write(new TextEncoder().encode(JSON.stringify(info, null, 2) + '\n'));
  } finally {
    await handle.close();
  }
}

/** The servers there are, by when they were hosted. */
export async function listServers(cmd: Command): Promise<ServerInfo[]> {
  const vfs = cmd.sys.vfs;
  if (!(await vfs.exists(cmd.access, SERVERS))) return [];
  const ids = (await vfs.children(cmd.access, SERVERS)).filter((child) => child.node.type === 'directory').map((child) => child.name);
  const servers = (await Promise.all(ids.map((id) => readServer(cmd, id)))).filter((info): info is ServerInfo => !!info);
  return servers.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** How long a new seat waits for the quake-server service to read it. */
const SEAT_READY_MS = 15_000;

/**
 * Take a seat in the running game `info` for `name`: the caller's own seat of that name again when
 * nobody has it open (a page reloaded), else the first free of `name-2`, `name-3` and on. The seat is
 * the caller's: a folder in the server's `players/` with `in`, which only they write (and read), and
 * `out`, which only they read; the service, the administrator, reads the one and writes the other.
 * Answers once the service reads `in`, so nothing the player sends before is lost.
 */
export async function takeSeat(cmd: Command, info: ServerInfo, name: string): Promise<Seat> {
  const vfs = cmd.sys.vfs;
  let seat = name;
  for (let n = 2;; n++) {
    const path = seatPath(info.id, seat);
    if (!(await vfs.exists(cmd.access, path))) {
      await vfs.create(cmd.access, 'directory', seatsPath(info.id), seat, { props: { mode: 0o755 } });
      await vfs.create(cmd.access, 'stream', path, 'in', { props: { mode: 0o600 } });
      await vfs.create(cmd.access, 'stream', path, 'out', { props: { mode: 0o400 } });
      break;
    }
    const mine = (await vfs.get(cmd.access, path)).props.uid === cmd.access.uid;
    const open = await vfs.stat(cmd.access, seatIn(info.id, seat)).then((stat) => (stat as { writer?: boolean }).writer === true, () => true);
    if (mine && !open) break;
    seat = `${name}-${n}`;
  }
  const read = await waitFor(async () => {
    const stat = await vfs.stat(cmd.access, seatIn(info.id, seat)).catch(() => undefined);
    return ((stat as { readers?: number } | undefined)?.readers ?? 0) > 0;
  }, SEAT_READY_MS);
  if (!read) throw new Error(`the quake-server service has not taken seat ${seat} in ${info.id}; is it running?`);
  return {
    server: info.id,
    game: info.game,
    title: info.title,
    engine: info.engine,
    map: info.map,
    seat,
    in: seatIn(info.id, seat),
    out: seatOut(info.id, seat),
    address: SERVER_ADDRESS,
  };
}

/** Wait until `done` says yes, asking every `everyMs`, for at most `forMs`; answers whether it did. */
export async function waitFor(done: () => Promise<boolean>, forMs: number, everyMs = 250): Promise<boolean> {
  const until = Date.now() + forMs;
  for (;;) {
    if (await done()) return true;
    if (Date.now() >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

/** The error's message, for a line on stderr. */
export const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
