/**
 * The network both engines play on, over EiN's stream nodes in place of UDP. An engine's sockets
 * (`net_ein.c` in each engine) hand their datagrams to a `Network`, which sends each down the link
 * to the address it is for, and keeps those that come up a link for the socket they are for until
 * the engine reads them.
 *
 * A link is one player's pair of stream nodes: `in`, which the player writes and the server reads,
 * and `out`, which the server writes and the player reads. A stream carries bytes, not messages,
 * and may split or join what was written, so each datagram goes framed: the length of what follows
 * (two bytes, big-endian), the port it is from, the port it is for, then its bytes. `Deframer` puts
 * them back together on the other side.
 *
 * Addresses are fake: the server gives each player one of its own (`playerAddress`), which tells it
 * which link a datagram goes down, and a player sees the server at `SERVER_ADDRESS`, whatever
 * instance it is on. Ports tell an end's sockets apart: Quake 2's server listens on 27910 and its
 * clients on 27901; Quake's server on 26000, with a socket of its own for each player it accepts.
 */

/** What the server is to its players: the address their engine connects to. */
export const SERVER_ADDRESS = '10.66.0.1';

/** The bytes before a datagram's own: its length, the port it is from and the port it is for. */
export const FRAME_HEADER = 6;

/** The longest datagram a frame carries; Quake's are at most 8 KiB, Quake 2's 1400 bytes. */
export const MAX_DATAGRAM = 65535 - 4;

/** How many datagrams a socket keeps unread before it drops the oldest: a game that stopped reading (a hidden page) falls behind no further. */
const SOCKET_QUEUE = 256;

/** A datagram as an engine sends and reads it. */
export type Datagram = { from: number; to: number; data: Uint8Array };

/** `address`, `a.b.c.d`, as the one number the engines pass it as. */
export const addressNumber = (address: string): number => address.split('.').reduce((number, part) => number * 256 + Number(part), 0) >>> 0;

/** The number an engine passes an address as, as `a.b.c.d`. */
export const addressText = (number: number): string => [24, 16, 8, 0].map((shift) => (number >>> shift) & 255).join('.');

/**
 * The address the server gives its `index`th player, from 1 on: 10.66.0.2, 10.66.0.3 and on, past
 * the server's own.
 */
export const playerAddress = (index: number): string => addressText(addressNumber(SERVER_ADDRESS) + index);

/** The datagram `data` from port `from` to port `to`, framed for a stream. */
export function frame(from: number, to: number, data: Uint8Array): Uint8Array {
  if (data.length > MAX_DATAGRAM) throw new Error(`a datagram of ${data.length} bytes is longer than a frame carries`);
  const framed = new Uint8Array(FRAME_HEADER + data.length);
  const view = new DataView(framed.buffer);
  view.setUint16(0, data.length + 4);
  view.setUint16(2, from);
  view.setUint16(4, to);
  framed.set(data, FRAME_HEADER);
  return framed;
}

/** Puts a stream's frames back together, whichever way it split or joined them. */
export class Deframer {
  #held = new Uint8Array(0);

  /** The datagrams `chunk` completes, in order; what it ends with that is not whole yet waits for the next. */
  push(chunk: Uint8Array): Datagram[] {
    let bytes = chunk;
    if (this.#held.length > 0) {
      bytes = new Uint8Array(this.#held.length + chunk.length);
      bytes.set(this.#held);
      bytes.set(chunk, this.#held.length);
    }
    const datagrams: Datagram[] = [];
    let at = 0;
    while (bytes.length - at >= 2) {
      const length = (bytes[at] << 8) | bytes[at + 1];
      if (bytes.length - at < 2 + length) break;
      if (length >= 4) {
        const from = (bytes[at + 2] << 8) | bytes[at + 3];
        const to = (bytes[at + 4] << 8) | bytes[at + 5];
        datagrams.push({ from, to, data: bytes.slice(at + FRAME_HEADER, at + 2 + length) });
      }
      at += 2 + length;
    }
    this.#held = bytes.slice(at);
    return datagrams;
  }
}

/** A datagram waiting for its socket: from whom, the address and port, and its bytes. */
export type Received = { ip: number; port: number; data: Uint8Array };

/**
 * An engine's network: `Module.einNet`, which `net_ein.c` calls. `route` finds the link to an
 * address, a function that sends a framed datagram down it, or nothing when there is none: the
 * datagram is dropped, as UDP drops it.
 */
export class Network {
  readonly #sockets = new Map<number, Received[]>();
  #nextPort = 50000;

  constructor(private readonly route: (ip: number) => ((framed: Uint8Array) => void) | undefined) {}

  /** Open the socket at `port`, or at a free port when it is 0; answers its port. */
  open(port: number): number {
    if (port === 0) {
      while (this.#sockets.has(this.#nextPort)) this.#nextPort = this.#nextPort >= 65000 ? 50000 : this.#nextPort + 1;
      port = this.#nextPort++;
    }
    if (!this.#sockets.has(port)) this.#sockets.set(port, []);
    return port;
  }

  close(port: number): void {
    this.#sockets.delete(port);
  }

  /** The engine sends `data` from its socket at `from` to `ip`'s port `to`. */
  send(from: number, ip: number, to: number, data: Uint8Array): void {
    this.route(ip)?.(frame(from, to, data));
  }

  /** The next datagram for the socket at `port`, if one waits. */
  recv(port: number): Received | undefined {
    return this.#sockets.get(port)?.shift();
  }

  /** A datagram came up the link from `ip`: kept for its socket when that is open, else dropped. */
  deliver(ip: number, datagram: Datagram): void {
    const queue = this.#sockets.get(datagram.to);
    if (!queue) return;
    if (queue.length >= SOCKET_QUEUE) queue.shift();
    queue.push({ ip, port: datagram.from, data: datagram.data });
  }
}
