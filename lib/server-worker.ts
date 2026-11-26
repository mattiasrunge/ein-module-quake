/**
 * A hosted game's dedicated server, in a worker of EiN's process of its own, so a slow frame never
 * holds up EiN. The quake-server service (`lib/server.ts`) makes the worker from this file's text and
 * starts it with the engine's glue and the network (`lib/net.ts`) as URLs it imports, the server's
 * wasm, and the game's paks. Then it passes each chunk a player's `in` stream gives it, and writes
 * each framed datagram the worker sends it to that player's `out`: the framing is the worker's, the
 * streams the service's. It imports nothing itself, so it runs as it is.
 */
import type { Deframer, Network } from './net.ts';

/** Start the server: the engine's glue and `lib/net.ts` as URLs, its wasm, the paks for its game folder, and its command line. */
export type StartServer = { type: 'start'; glue: string; net: string; wasm: Uint8Array; folder: string; paks: Uint8Array[]; args: string[] };

/** What the service tells the worker: start, a chunk from the player at `ip`, or that player gone, whose half-read frame is dropped. */
export type ToWorker = StartServer | { type: 'chunk'; ip: number; bytes: Uint8Array } | { type: 'gone'; ip: number };

/**
 * What the worker tells the service: a framed datagram for the player at `ip`, a line the server
 * printed, who plays (`ein_status`'s JSON), that the server runs, or that it ended, with why when it
 * failed.
 */
export type FromWorker =
  | { type: 'send'; ip: number; framed: Uint8Array }
  | { type: 'log'; line: string }
  | { type: 'status'; status: string }
  | { type: 'started' }
  | { type: 'ended'; error?: string };

/** How often the server runs: it reads what came every time, and moves the game on when its frame is due. */
const TICK_MS = 5;

/** How often the worker says who plays. */
const STATUS_MS = 2000;

/** The dedicated server's exports (`engine/quake2/server_ein.c`, `engine/server_ein.c`). */
type ServerModule = {
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: Uint8Array): void };
  HEAPU32: Uint32Array;
  stringToNewUTF8(text: string): number;
  UTF8ToString(at: number): string;
  _malloc(bytes: number): number;
  _ein_start(argc: number, argv: number): void;
  _ein_tick(): void;
  _ein_status(): number;
};

type Scope = { onmessage: ((event: MessageEvent<ToWorker>) => void) | null; postMessage(message: FromWorker, transfer?: Transferable[]): void; close(): void };
const scope = globalThis as unknown as Scope;
const tell = (message: FromWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

let network: Network | undefined;
const deframers = new Map<number, Deframer>();
let makeDeframer: (() => Deframer) | undefined;

/** The game ended: it quit, or `error` stopped it. The service ends the worker. */
function end(error?: unknown) {
  const exit = error as { name?: string; status?: number } | undefined;
  const failed = error !== undefined && !(exit?.name === 'ExitStatus' && exit.status === 0);
  tell({ type: 'ended', ...(failed ? { error: exit?.name === 'ExitStatus' ? `the server exited with status ${exit.status}` : String(error) } : {}) });
}

async function start({ glue, net, wasm, folder, paks, args }: StartServer) {
  const [{ default: create }, { Deframer, Network, addressNumber, SERVER_ADDRESS }] = await Promise.all([
    import(glue) as Promise<{ default: (options: object) => Promise<ServerModule> }>,
    import(net) as Promise<typeof import('./net.ts')>,
  ]);
  makeDeframer = () => new Deframer();
  const own = addressNumber(SERVER_ADDRESS);
  // Every player's datagrams go back to them; none goes to the server's own address.
  network = new Network((ip) => ip === own ? undefined : (framed) => tell({ type: 'send', ip, framed }, [framed.buffer as ArrayBuffer]));
  const log = (line: string) => tell({ type: 'log', line });
  // The wasm is handed over, so the glue never looks for it: its own URL, a blob's, has nothing beside it.
  const instantiateWasm = (imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) => {
    WebAssembly.instantiate(wasm as Uint8Array<ArrayBuffer>, imports).then(({ instance }) => receive(instance), end);
    return {};
  };
  const engine = await create({ instantiateWasm, print: log, printErr: log, einNet: network });
  engine.FS.mkdirTree(folder);
  paks.forEach((bytes, i) => engine.FS.writeFile(`${folder}/pak${i}.pak`, bytes));
  const argv = engine._malloc(args.length * 4);
  args.forEach((arg, i) => engine.HEAPU32[(argv >> 2) + i] = engine.stringToNewUTF8(arg));
  try {
    engine._ein_start(args.length, argv);
  } catch (error) {
    end(error);
    return;
  }
  tell({ type: 'started' });

  const ticking = setInterval(() => {
    try {
      engine._ein_tick();
    } catch (error) {
      clearInterval(ticking);
      clearInterval(reporting);
      end(error);
    }
  }, TICK_MS);
  const reporting = setInterval(() => tell({ type: 'status', status: engine.UTF8ToString(engine._ein_status()) }), STATUS_MS);
}

scope.onmessage = ({ data: message }) => {
  if (message.type === 'start') {
    start(message).catch(end);
  } else if (message.type === 'chunk' && network && makeDeframer) {
    let deframer = deframers.get(message.ip);
    if (!deframer) deframers.set(message.ip, deframer = makeDeframer());
    for (const datagram of deframer.push(message.bytes)) network.deliver(message.ip, datagram);
  } else if (message.type === 'gone') {
    deframers.delete(message.ip);
  }
};
