/**
 * The network both engines play on, over EiN's socket nodes in place of UDP. An engine's sockets
 * (`net_ein.c` in each engine) hand their datagrams to a `Network`, which sends each down the link
 * to the address it is for, and keeps those that come up a link for the socket they are for until
 * the engine reads them.
 *
 * A link is one player's connection to the server's socket node, which carries messages both ways.
 * Each datagram goes framed: the length of what follows (two bytes, big-endian), the port it is
 * from, the port it is for, then its bytes. `Deframer` puts them back together on the other side.
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

/** The datagram `data` from port `from` to port `to`, framed for a link. */
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

/** Puts a link's frames back together, whichever way it split or joined them. */
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

  /**
   * `pump`, when given, is called before every read, to deliver what came since: the server's worker
   * takes its players' datagrams from a `Ring` there, so they reach a game that reads in a loop
   * without returning, as Quake's server waits for its players' answers in one.
   */
  constructor(private readonly route: (ip: number) => ((framed: Uint8Array) => void) | undefined, private readonly pump?: () => void) {}

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
    this.pump?.();
    return this.#sockets.get(port)?.shift();
  }

  /** How many datagrams wait for the socket at `port`. */
  waiting(port: number): number {
    this.pump?.();
    return this.#sockets.get(port)?.length ?? 0;
  }

  /** A datagram came up the link from `ip`: kept for its socket when that is open, else dropped. */
  deliver(ip: number, datagram: Datagram): void {
    const queue = this.#sockets.get(datagram.to);
    if (!queue) return;
    if (queue.length >= SOCKET_QUEUE) queue.shift();
    queue.push({ ip, port: datagram.from, data: datagram.data });
  }
}

/** What a `Ring` holds before its writer drops what does not fit: a few seconds of every player's datagrams. */
export const RING_BYTES = 1 << 22;

/**
 * The players' datagrams on their way to the server's worker, in memory both share: the service
 * writes each datagram a player's connection gives with the player's address, and the worker reads them
 * whenever its game reads, even while it runs without returning, when no message could reach it. One
 * writer, one reader. A record is the address, the length of what follows, the ports and the bytes;
 * one that does not fit is dropped, as the network drops a datagram.
 */
export class Ring {
  readonly #positions: Int32Array;
  readonly #bytes: Uint8Array;

  constructor(readonly buffer: SharedArrayBuffer = new SharedArrayBuffer(8 + RING_BYTES)) {
    this.#positions = new Int32Array(buffer, 0, 2);
    this.#bytes = new Uint8Array(buffer, 8);
  }

  /** Write the datagram from the player at `ip`; answers whether there was room. */
  write(ip: number, datagram: Datagram): boolean {
    const bytes = new Uint8Array(4 + datagram.data.length);
    bytes.set([datagram.from >> 8, datagram.from & 255, datagram.to >> 8, datagram.to & 255]);
    bytes.set(datagram.data, 4);
    return this.#put(ip, bytes);
  }

  /** Each datagram written since the last read, in order, with the address of the player it is from. */
  read(each: (ip: number, datagram: Datagram) => void): void {
    const end = Atomics.load(this.#positions, 0) >>> 0;
    let at = Atomics.load(this.#positions, 1) >>> 0;
    while (at !== end) {
      const header = this.#take(at, 8);
      const view = new DataView(header.buffer);
      const ip = view.getUint32(0);
      const length = view.getUint32(4);
      at = (at + 8) >>> 0;
      const bytes = this.#take(at, length);
      each(ip, { from: (bytes[0] << 8) | bytes[1], to: (bytes[2] << 8) | bytes[3], data: bytes.subarray(4) });
      at = (at + length) >>> 0;
    }
    Atomics.store(this.#positions, 1, at | 0);
  }

  #put(ip: number, bytes: Uint8Array): boolean {
    const at = Atomics.load(this.#positions, 0) >>> 0;
    const read = Atomics.load(this.#positions, 1) >>> 0;
    const size = 8 + bytes.length;
    if (((at - read) >>> 0) + size > this.#bytes.length) return false;
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint32(0, ip);
    view.setUint32(4, bytes.length);
    this.#copyIn(at, header);
    this.#copyIn((at + 8) >>> 0, bytes);
    Atomics.store(this.#positions, 0, (at + size) | 0);
    return true;
  }

  #copyIn(at: number, bytes: Uint8Array): void {
    const start = at % this.#bytes.length;
    const first = Math.min(bytes.length, this.#bytes.length - start);
    this.#bytes.set(bytes.subarray(0, first), start);
    this.#bytes.set(bytes.subarray(first), 0);
  }

  #take(at: number, length: number): Uint8Array {
    const start = at % this.#bytes.length;
    const first = Math.min(length, this.#bytes.length - start);
    const out = new Uint8Array(length);
    out.set(this.#bytes.subarray(start, start + first));
    out.set(this.#bytes.subarray(0, length - first), first);
    return out;
  }
}
