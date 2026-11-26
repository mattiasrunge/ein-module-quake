import type { Command } from '@ein/client';
import type { Seat, ServerInfo } from './api.ts';
import { readWhole } from './catalog.ts';
import { SERVERS } from './games.ts';
import { SERVER_ADDRESS } from './net.ts';

/** A server's folder. */
export const serverPath = (id: string): string => `${SERVERS}/${id}`;

/** A server's `server.json`. */
export const serverFile = (id: string): string => `${serverPath(id)}/server.json`;

/** A server's socket node, which the quake-server service listens on and each player connects to. */
export const serverSocket = (id: string): string => `${serverPath(id)}/socket`;

/** Sticky and open to every account, as `/tmp` is: anyone makes a folder in it, and only its owner (or the administrator) removes it. */
export const SHARED_FOLDER_MODE = 0o1777;

/** How long a reader waits before it reads a `server.json` again that it caught while it was written. */
const REREAD_MS = 150;

/**
 * A server's `server.json`, or undefined when it is not there or cannot be read. Writing it empties
 * it first, so one read empty or cut short is read once more a moment later.
 */
export async function readServer(cmd: Command, id: string): Promise<ServerInfo | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, REREAD_MS));
    try {
      return JSON.parse(new TextDecoder().decode(await readWhole(cmd, serverFile(id)))) as ServerInfo;
    } catch {
      if (!(await cmd.sys.vfs.exists(cmd.access, serverFile(id)).catch(() => false))) return undefined;
    }
  }
  return undefined;
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

/** The way into the running game `info`: its socket, and the address a player's engine connects to. */
export const seatOf = (info: ServerInfo): Seat => ({
  server: info.id,
  game: info.game,
  title: info.title,
  engine: info.engine,
  map: info.map,
  socket: serverSocket(info.id),
  address: SERVER_ADDRESS,
});

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
