/**
 * Save / load: serialize world state to JSON, gzip it on the wire and at rest.
 *
 * Format (v12):
 * {
 *   version: 12,
 *   tileGrid: { W, H, elevation: number[], biome: number[], stockpile: number[], wall: number[], door: number[], torch: number[], roof: number[], ignoreRoof: number[] },
 *   cows: [ {
 *     name, drafted: boolean, position: {x,y,z}, hunger: number,
 *     job: { kind, state, payload }, path: { steps, index },
 *     inventory: { itemKind: string | null }
 *   } ],
 *   trees: [ { i, j, marked: boolean, progress: number } ],
 *   items: [ { i, j, kind: string, count: number, capacity: number } ],
 *   buildSites: [ { i, j, kind, requiredKind, required, delivered, progress } ],
 *   walls: [ { i, j, decon: boolean, progress: number } ],
 *   doors: [ { i, j, decon: boolean, progress: number } ],
 *   torches: [ { i, j, decon: boolean, progress: number } ],
 *   roofs: [ { i, j, decon: boolean, progress: number } ]
 * }
 *
 * Browser uses CompressionStream('gzip'). Node tests use zlib.
 *
 * On load, runs the migration chain (see ./migrations/index.js) so old saves
 * always upgrade cleanly.
 */

import { tileToWorld } from './coords.js';
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
 * @typedef SerializedBuildSite
 * @property {number} i
 * @property {number} j
 * @property {string} kind
 * @property {string} requiredKind
 * @property {number} required
 * @property {number} delivered
 * @property {number} progress
 */

/**
 * @typedef SerializedWall
 * @property {number} i
 * @property {number} j
 * @property {boolean} decon  player marked it for demolition
 * @property {number} progress  0..1 demolition progress at save time
 */

/**
 * @typedef SerializedDoor
 * @property {number} i
 * @property {number} j
 * @property {boolean} decon
 * @property {number} progress
 */

/**
 * @typedef SerializedTorch
 * @property {number} i
 * @property {number} j
 * @property {boolean} decon
 * @property {number} progress
 */

/**
 * @typedef SerializedRoof
 * @property {number} i
 * @property {number} j
 * @property {boolean} decon
 * @property {number} progress
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
  /** @type {SerializedBuildSite[]} */
  const buildSites = [];
  for (const { components } of world.query(['BuildSite', 'TileAnchor'])) {
    buildSites.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      kind: components.BuildSite.kind,
      requiredKind: components.BuildSite.requiredKind,
      required: components.BuildSite.required,
      delivered: components.BuildSite.delivered,
      progress: components.BuildSite.progress,
    });
  }
  /** @type {SerializedWall[]} */
  const walls = [];
  for (const { components } of world.query(['Wall', 'TileAnchor'])) {
    walls.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      decon: components.Wall.deconstructJobId > 0,
      progress: components.Wall.progress ?? 0,
    });
  }
  /** @type {SerializedDoor[]} */
  const doors = [];
  for (const { components } of world.query(['Door', 'TileAnchor'])) {
    doors.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      decon: components.Door.deconstructJobId > 0,
      progress: components.Door.progress ?? 0,
    });
  }
  /** @type {SerializedTorch[]} */
  const torches = [];
  for (const { components } of world.query(['Torch', 'TileAnchor'])) {
    torches.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      decon: components.Torch.deconstructJobId > 0,
      progress: components.Torch.progress ?? 0,
    });
  }
  /** @type {SerializedRoof[]} */
  const roofs = [];
  for (const { components } of world.query(['Roof', 'TileAnchor'])) {
    roofs.push({
      i: components.TileAnchor.i,
      j: components.TileAnchor.j,
      decon: components.Roof.deconstructJobId > 0,
      progress: components.Roof.progress ?? 0,
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
      wall: Array.from(tileGrid.wall),
      door: Array.from(tileGrid.door),
      torch: Array.from(tileGrid.torch),
      roof: Array.from(tileGrid.roof),
      ignoreRoof: Array.from(tileGrid.ignoreRoof),
    },
    cows,
    trees,
    items,
    buildSites,
    walls,
    doors,
    torches,
    roofs,
  };
}

/**
 * @param {{ version: number, tileGrid: { W: number, H: number, elevation: number[], biome: number[], stockpile?: number[], wall?: number[], door?: number[], torch?: number[], roof?: number[], ignoreRoof?: number[] } }} state
 */
export function hydrateTileGrid(state) {
  const tg = new TileGrid(state.tileGrid.W, state.tileGrid.H);
  tg.elevation.set(state.tileGrid.elevation);
  tg.biome.set(state.tileGrid.biome);
  if (state.tileGrid.stockpile) tg.stockpile.set(state.tileGrid.stockpile);
  if (state.tileGrid.wall) tg.wall.set(state.tileGrid.wall);
  if (state.tileGrid.door) tg.door.set(state.tileGrid.door);
  if (state.tileGrid.torch) tg.torch.set(state.tileGrid.torch);
  if (state.tileGrid.roof) tg.roof.set(state.tileGrid.roof);
  if (state.tileGrid.ignoreRoof) tg.ignoreRoof.set(state.tileGrid.ignoreRoof);
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
    if (it.count <= 0) continue;
    const w = tileToWorld(it.i, it.j, grid.W, grid.H);
    world.spawn({
      Item: { kind: it.kind, count: it.count, capacity: it.capacity },
      ItemViz: {},
      TileAnchor: { i: it.i, j: it.j },
      Position: { x: w.x, y: grid.getElevation(it.i, it.j), z: w.z },
    });
  }
}

/**
 * Spawn BuildSite entities from a (migrated) save state. Tiles holding a
 * BuildSite do NOT get their wall bit set — the blueprint stays walkable so
 * haulers can deliver. Any outstanding board jobs for these sites (haul /
 * build) are re-posted by the regular rare-tier poster next tick, so we don't
 * snapshot job state here.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {{ buildSites?: SerializedBuildSite[] }} state
 */
export function hydrateBuildSites(world, grid, state) {
  const sites = state.buildSites ?? [];
  for (const s of sites) {
    if (!grid.inBounds(s.i, s.j)) continue;
    const w = tileToWorld(s.i, s.j, grid.W, grid.H);
    world.spawn({
      BuildSite: {
        kind: s.kind,
        requiredKind: s.requiredKind,
        required: s.required,
        delivered: s.delivered,
        buildJobId: 0,
        progress: s.progress ?? 0,
      },
      BuildSiteViz: {},
      TileAnchor: { i: s.i, j: s.j },
      Position: { x: w.x, y: grid.getElevation(s.i, s.j), z: w.z },
    });
  }
}

/**
 * Spawn structure (Wall/Door/Torch) entities from a (migrated) save state. The
 * grid's wall/door/torch bitmaps are authoritative for pathing (set directly
 * from the tileGrid section in hydrateTileGrid); these entities just own the
 * instance slot for rendering + round-tripping. If a structure was marked for
 * deconstruction at save time, re-post the 'deconstruct' job through `board`
 * so cows resume the demolition.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {Array<{i: number, j: number, decon?: boolean, progress?: number}>} items
 * @param {'wall'|'door'|'torch'|'roof'} kind
 */
const STRUCT_COMP_BY_KIND = /** @type {const} */ ({
  wall: 'Wall',
  door: 'Door',
  torch: 'Torch',
  roof: 'Roof',
});

function hydrateStructures(world, grid, board, items, kind) {
  const compName = STRUCT_COMP_BY_KIND[kind];
  const vizName = `${compName}Viz`;
  for (const s of items) {
    if (!grid.inBounds(s.i, s.j)) continue;
    const w = tileToWorld(s.i, s.j, grid.W, grid.H);
    const id = world.spawn({
      [compName]: { deconstructJobId: 0, progress: s.progress ?? 0 },
      [vizName]: {},
      TileAnchor: { i: s.i, j: s.j },
      Position: { x: w.x, y: grid.getElevation(s.i, s.j), z: w.z },
    });
    if (s.decon) {
      const job = board.post('deconstruct', { entityId: id, kind, i: s.i, j: s.j });
      const tag = world.get(id, compName);
      if (tag) tag.deconstructJobId = job.id;
    }
  }
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ walls?: SerializedWall[] }} state
 */
export function hydrateWalls(world, grid, board, state) {
  hydrateStructures(world, grid, board, state.walls ?? [], 'wall');
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ doors?: SerializedDoor[] }} state
 */
export function hydrateDoors(world, grid, board, state) {
  hydrateStructures(world, grid, board, state.doors ?? [], 'door');
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ torches?: SerializedTorch[] }} state
 */
export function hydrateTorches(world, grid, board, state) {
  hydrateStructures(world, grid, board, state.torches ?? [], 'torch');
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {{ roofs?: SerializedRoof[] }} state
 */
export function hydrateRoofs(world, grid, board, state) {
  hydrateStructures(world, grid, board, state.roofs ?? [], 'roof');
}

/**
 * Migrate a parsed save state up to CURRENT_VERSION and return it as the
 * current schema shape.
 * @param {{ version: number, [k: string]: any }} parsed
 * @returns {{ version: number, tileGrid: { W: number, H: number, elevation: number[], biome: number[], stockpile: number[], wall: number[], door: number[], torch: number[], roof: number[], ignoreRoof: number[] }, cows: SerializedCow[], trees: SerializedTree[], items: SerializedItem[], buildSites: SerializedBuildSite[], walls: SerializedWall[], doors: SerializedDoor[], torches: SerializedTorch[], roofs: SerializedRoof[] }}
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
