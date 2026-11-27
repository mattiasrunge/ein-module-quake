/**
 * What the page starts the module's engine worker with (`EngineStart.payload`), for Quake's, Quake
 * II's and Quake 3's engines alike. Free of the DOM, as everything the worker imports is.
 */
import type { EmscriptenBuild } from '@games/engine';
import type { EngineName } from '../../lib/api.ts';

/**
 * Which engine plays the game, and its build in `assets/` by its URLs; the folder of the engine's
 * file system the player's files it writes are in; its command line; and, for Quake's and Quake
 * II's, the commands it runs after its configuration and, for Quake's, its heap's megabytes.
 */
export type QuakeStart = {
  family: EngineName;
  build: EmscriptenBuild;
  writes: string;
  args: string[];
  commands?: string;
  heap?: number;
};
