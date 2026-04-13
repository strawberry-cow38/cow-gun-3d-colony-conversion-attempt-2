/**
 * Save / load: serialize world state to JSON, gzip it on the wire and at rest.
 *
 * Format (v4):
 * {
 *   version: 4,
 *   tileGrid: { W, H, elevation: number[], biome: number[], stockpile: number[] },
 *   cows: [ {
 *     name, position: {x,y,z}, hunger: number,
 *     job: { kind, state, payload }, path: { steps, index },
 *     inventory: { itemKind: string | null }
 *   } ]
 * }
 *
 * Browser uses CompressionStream('gzip'). Node tests use zlib.
 *
 * On load, runs the migration chain (see ./migrations/index.js) so old saves
 * always upgrade cleanly.
 */

import { CURRENT_VERSION, runMigrations } from './migrations/index.js';
import { TileGrid } from './tileGrid.js';

/**
 * @typedef SerializedCow
 * @property {string} name
 * @property {{ x: number, y: number, z: number }} position
 * @property {number} hunger
 * @property {{ kind: string, state: string, payload: Record<string, any> }} job
 * @property {{ steps: { i: number, j: number }[], index: number }} path
 * @property {{ itemKind: string | null }} inventory
 */

/**
 * @param {TileGrid} tileGrid
 * @param {import('../ecs/world.js').World} world
 */
export function serializeState(tileGrid, world) {
  /** @type {SerializedCow[]} */
  const cows = [];
  for (const { components } of world.query([
    'Cow',
    'Position',
    'Hunger',
    'Brain',
    'Job',
    'Path',
    'Inventory',
  ])) {
    cows.push({
      name: components.Brain.name,
      position: { x: components.Position.x, y: components.Position.y, z: components.Position.z },
      hunger: components.Hunger.value,
      job: {
        kind: components.Job.kind,
        state: components.Job.state,
        payload: components.Job.payload,
      },
      path: {
        steps: components.Path.steps.map((s) => ({ i: s.i, j: s.j })),
        index: components.Path.index,
      },
      inventory: { itemKind: components.Inventory.itemKind },
    });
  }
  return {
    version: CURRENT_VERSION,
    tileGrid: {
      W: tileGrid.W,
      H: tileGrid.H,
      elevation: Array.from(tileGrid.elevation),
      biome: Array.from(tileGrid.biome),
      stockpile: Array.from(tileGrid.stockpile),
    },
    cows,
  };
}

/**
 * @param {{ version: number, tileGrid: { W: number, H: number, elevation: number[], biome: number[], stockpile?: number[] } }} state
 */
export function hydrateTileGrid(state) {
  const tg = new TileGrid(state.tileGrid.W, state.tileGrid.H);
  tg.elevation.set(state.tileGrid.elevation);
  tg.biome.set(state.tileGrid.biome);
  if (state.tileGrid.stockpile) tg.stockpile.set(state.tileGrid.stockpile);
  return tg;
}

/**
 * Spawn cow entities from a (migrated) save state. Existing cows in the world
 * are NOT removed — caller is responsible for clearing the world first if it
 * wants a clean replace.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {{ cows?: SerializedCow[] }} state
 */
export function hydrateCows(world, state) {
  const cows = state.cows ?? [];
  for (const c of cows) {
    const job = c.job ?? { kind: 'none', state: 'idle', payload: {} };
    const path = c.path ?? { steps: [], index: 0 };
    const inv = c.inventory ?? { itemKind: null };
    world.spawn({
      Cow: {},
      Position: { ...c.position },
      PrevPosition: { ...c.position },
      Velocity: { x: 0, y: 0, z: 0 },
      Hunger: { value: c.hunger },
      Brain: { name: c.name },
      Job: { kind: job.kind, state: job.state, payload: job.payload ?? {} },
      Path: { steps: path.steps.map((s) => ({ i: s.i, j: s.j })), index: path.index },
      Inventory: { itemKind: inv.itemKind ?? null },
      CowViz: {},
    });
  }
}

/**
 * Migrate a parsed save state up to CURRENT_VERSION and return it as the
 * current schema shape.
 * @param {{ version: number, [k: string]: any }} parsed
 * @returns {{ version: number, tileGrid: { W: number, H: number, elevation: number[], biome: number[] }, cows: SerializedCow[] }}
 */
export function loadState(parsed) {
  return /** @type {any} */ (runMigrations(parsed));
}

/**
 * Gzip a string using the browser's CompressionStream API.
 * @param {string} json
 * @returns {Promise<Uint8Array>}
 */
export async function gzipString(json) {
  const encoder = new TextEncoder();
  const stream = new Blob([/** @type {BlobPart} */ (encoder.encode(json))]).stream();
  const gz = stream.pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(gz).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Gunzip bytes back to a string.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function gunzipBytes(bytes) {
  const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream();
  const ds = stream.pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(ds).arrayBuffer();
  return new TextDecoder().decode(buf);
}
