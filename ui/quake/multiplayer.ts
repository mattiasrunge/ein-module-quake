import { openNodeSocket, shq } from '@ein/ui/lib';
import { execCommand } from '@ein/ui/signals';
import type { GameMode, Seat, ServerInfo } from '../../lib/api.ts';
import { addressNumber, Deframer, Network, SERVER_ADDRESS } from '../../lib/net.ts';

export type { GameMode, Seat, ServerInfo };

/** The games people host here, as `quake-servers` lists them. */
export const SERVERS_COMMAND = 'quake-servers';

/** Host `game` on `map` for `maxPlayers` in `mode` (`quake-host`), which answers once its server runs. */
export async function hostServer(game: string, map: string, maxPlayers: number, mode: GameMode): Promise<ServerInfo> {
  return await execCommand<ServerInfo>(`quake-host ${shq(game)} ${shq(map)} --max ${maxPlayers} --mode ${mode}`);
}

/** Take a seat in the server `id` (`quake-join`). */
export async function joinServer(id: string): Promise<Seat> {
  return await execCommand<Seat>(`quake-join ${shq(id)}`);
}

/** Stop the server `id` (`quake-stop`), which drops everyone in it. */
export async function stopServer(id: string): Promise<void> {
  await execCommand(`quake-stop ${shq(id)}`);
}

/**
 * A seat's two streams held open: the network the game plays on, whose datagrams go down `in` and
 * come up `out`. `ended` settles with why when either socket closes, which the server's going does
 * too; `close` lets go of both.
 */
export type Link = { network: Network; ended: Promise<string>; close(): void };

/** Opens a socket on a seat's stream: `openNodeSocket` on this instance's own. */
export type OpenSocket = (path: string, mode: 'r' | 'w') => WebSocket;

/** Wait until `socket` is open; rejects with why when it closes first. */
function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('close', (event) => reject(new Error(event.reason || `the socket closed (${event.code})`)), { once: true });
  });
}

/**
 * Hold `seat`'s streams open over WebSockets, `out` first, so the server's first answer finds its
 * reader there, then `in`.
 */
export async function openLink(seat: Seat, open: OpenSocket = openNodeSocket): Promise<Link> {
  const out = open(seat.out, 'r');
  let input: WebSocket | undefined;
  try {
    await opened(out);
    input = open(seat.in, 'w');
    await opened(input);
  } catch (error) {
    out.close();
    input?.close();
    throw error;
  }
  const writer = input;
  // Every datagram goes to the server, whatever address the game sends it to: a seat reaches only it.
  const network = new Network(() => (framed) => {
    if (writer.readyState === WebSocket.OPEN) writer.send(framed as Uint8Array<ArrayBuffer>);
  });
  const deframer = new Deframer();
  const server = addressNumber(SERVER_ADDRESS);
  out.addEventListener('message', (event) => {
    for (const datagram of deframer.push(new Uint8Array(event.data as ArrayBuffer))) network.deliver(server, datagram);
  });
  const ended = new Promise<string>((resolve) => {
    const closed = (event: CloseEvent) => resolve(event.reason || 'the connection to the server closed');
    out.addEventListener('close', closed, { once: true });
    writer.addEventListener('close', closed, { once: true });
  });
  return {
    network,
    ended,
    close() {
      out.close();
      writer.close();
    },
  };
}
