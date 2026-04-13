/**
 * Save / load: serialize world state to JSON, gzip it on the wire and at rest.
 *
 * Format (v7):
 * {
 *   version: 7,
 *   tileGrid: { W, H, elevation: number[], biome: number[], stockpile: number[] },
 *   cows: [ {
 *     name, drafted: boolean, position: {x,y,z}, hunger: number,
 *     job: { kind, state, payload }, path: { steps, index },
 *     inventory: { itemKind: string | null }
 *   } ],
 *   trees: [ { i, j, marked: boolean, progress: number } ],
 *   items: [ { i, j, kind: string, count: number, capacity: number } ]
 * }
 *
 * Browser uses CompressionStream('gzip'). Node tests use zlib.
 *
 * On load, runs the migration chain (see ./migrations/index.js) so old saves
 * always upgrade cleanly.
 */

import { tileToWorld } from './coords.js';
import { maxStack } from './items.js';
import { CURRENT_VERSION, runMigrations } from './migrations/index.js';
import { TileGrid } from './tileGrid.js';

/**
 * @typedef SerializedCow
 * @property {string} name
 * @property {boolean} drafted
 * @property {{ x: number, y: number, z: number }} position
 * @property {number} hunger
 * @property {{ kind: string, state: string, payload: Record<string, any> }} job
 * @property {{ steps: { i: number, j: number }[], index: number }} path
 * @property {{ itemKind: string | null }} inventory
 */

/**
 * @typedef SerializedTree
 * @property {number} i
 * @property {number} j
 * @property {boolean} marked
 * @property {number} progress  0..1 chop progress at save time
 */

/**
 * @typedef SerializedItem
 * @property {number} i
 * @property {number} j
 * @property {string} kind
 * @property {number} count
 * @property {number} capacity
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
      drafted: components.Cow.drafted === true,
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
  /** @type {SerializedTree[]} */
  const trees = [];
  for (const { components } of world.query(['Tree', 'TileAnchor'])) {
    trees.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      marked: components.Tree.markedJobId > 0,
      progress: components.Tree.progress,
    });
  }
  /** @type {SerializedItem[]} */
  const items = [];
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    items.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      kind: components.Item.kind,
      count: components.Item.count,
      capacity: components.Item.capacity,
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
    trees,
    items,
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
      Cow: { drafted: c.drafted === true },
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
 * Spawn tree entities from a (migrated) save state. Blocks their tiles on the
 * grid so pathfinding agrees with the render. If a tree was chop-designated at
 * save time, re-posts a chop job via the board and links the tree to it.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ trees?: SerializedTree[] }} state
 */
export function hydrateTrees(world, grid, board, state) {
  const trees = state.trees ?? [];
  for (const t of trees) {
    if (!grid.inBounds(t.i, t.j) || grid.isBlocked(t.i, t.j)) continue;
    grid.blockTile(t.i, t.j);
    const w = tileToWorld(t.i, t.j, grid.W, grid.H);
    const id = world.spawn({
      Tree: { markedJobId: 0, progress: t.progress ?? 0 },
      TreeViz: {},
      TileAnchor: { i: t.i, j: t.j },
      Position: { x: w.x, y: grid.getElevation(t.i, t.j), z: w.z },
    });
    if (t.marked) {
      const job = board.post('chop', { treeId: id, i: t.i, j: t.j });
      const tree = world.get(id, 'Tree');
      if (tree) tree.markedJobId = job.id;
    }
  }
}

/**
 * Spawn item entities from a (migrated) save state.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {{ items?: SerializedItem[] }} state
 */
export function hydrateItems(world, grid, state) {
  const items = state.items ?? [];
  for (const it of items) {
    if (!grid.inBounds(it.i, it.j)) continue;
    const w = tileToWorld(it.i, it.j, grid.W, grid.H);
    const cap = typeof it.capacity === 'number' ? it.capacity : maxStack(it.kind);
    const count = typeof it.count === 'number' ? it.count : 1;
    if (count <= 0) continue;
    world.spawn({
      Item: { kind: it.kind, count, capacity: cap },
      ItemViz: {},
      TileAnchor: { i: it.i, j: it.j },
      Position: { x: w.x, y: grid.getElevation(it.i, it.j), z: w.z },
    });
  }
}

/**
 * Migrate a parsed save state up to CURRENT_VERSION and return it as the
 * current schema shape.
 * @param {{ version: number, [k: string]: any }} parsed
 * @returns {{ version: number, tileGrid: { W: number, H: number, elevation: number[], biome: number[], stockpile: number[] }, cows: SerializedCow[], trees: SerializedTree[], items: SerializedItem[] }}
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
