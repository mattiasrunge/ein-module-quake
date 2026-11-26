import { fetchInvitation, NODE_SOCKET_CLOSE, openNodeSocket, shq } from '@ein/ui/lib';
import { execCommand } from '@ein/ui/signals';
import type { EngineName, GameMode, Invite, Seat, ServerInfo } from '../../lib/api.ts';
import { addressNumber, Deframer, Network, SERVER_ADDRESS } from '../../lib/net.ts';

export type { GameMode, Invite, Seat, ServerInfo };

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

/** Invite a guest from another EiN into the server `id` (`quake-invite`): the link, made whole with this EiN's address. */
export async function inviteToServer(id: string): Promise<Invite> {
  const invite = await execCommand<Invite>(`quake-invite ${shq(id)}`);
  return { ...invite, link: new URL(invite.link, globalThis.location.origin).href };
}

/** What an invitation's link says of its game after `#`: `<engine>:<game>:<map>`, as `quake-invite` writes it. */
export type InvitedGame = { engine: EngineName; game: string; map: string };

/** The game an invitation's link names, when it names one. */
export function invitedGame(link: string): InvitedGame | undefined {
  const match = /#(quake2?):([^:]*):(.+)$/.exec(link.trim());
  return match ? { engine: match[1] as EngineName, game: decodeURIComponent(match[2]), map: decodeURIComponent(match[3]) } : undefined;
}

/**
 * The seat an invitation's `link` opens on the EiN it is from, and how its streams are opened there:
 * with the invitation's token, from this page.
 */
export async function acceptInvitation(link: string, invited: InvitedGame): Promise<Joined> {
  const invitation = await fetchInvitation(link);
  const input = invitation.nodes.find((node) => node.mode === 'w');
  const output = invitation.nodes.find((node) => node.mode === 'r');
  if (!input || !output) throw new Error('the invitation does not open a seat in a game');
  const server = /\/servers\/([^/]+)\/players\//.exec(input.path)?.[1] ?? new URL(invitation.origin).host;
  return {
    seat: {
      server,
      game: invited.game,
      title: invited.game,
      engine: invited.engine,
      map: invited.map,
      seat: input.path.split('/').at(-2) ?? 'guest',
      in: input.path,
      out: output.path,
      address: SERVER_ADDRESS,
    },
    open: (path, mode) => openNodeSocket(path, mode, { origin: invitation.origin, invite: invitation.token }),
  };
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

/** A seat taken, here or with an invitation on another EiN, and how its streams are opened. */
export type Joined = { seat: Seat; open?: OpenSocket };

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
    const closed = (event: CloseEvent) =>
      resolve(
        event.code === NODE_SOCKET_CLOSE.ended
          ? 'the server stopped'
          : event.code === NODE_SOCKET_CLOSE.gone
          ? 'the seat was taken away, or its invitation ran out'
          : event.reason || 'the connection to the server closed',
      );
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
