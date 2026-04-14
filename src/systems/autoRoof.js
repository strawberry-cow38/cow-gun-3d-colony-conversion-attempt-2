/**
 * Auto-roof queueing + shared roof geometry helpers.
 *
 * `runAutoRoof`: after the rooms registry rebuilds, walk every enclosed room's
 * interior tiles and post a roof BuildSite for any tile that:
 *   - has no roof bit set,
 *   - has no `ignoreRoof` designation,
 *   - doesn't already have a roof BuildSite pending,
 *   - sits within ROOF_MAX_WALL_DISTANCE Chebyshev of a wall.
 *
 * Roofs cost no resources (required=0), so the haul poster immediately
 * promotes the site to a build job on the next rare tick (provided the tile
 * is roof-valid per `roofIsSupported`).
 *
 * `roofIsSupported` / `structureWithinChebyshev` live here rather than in a
 * render module so jobs/haul.js can import them without pulling in THREE.
 */

import { tileToWorld } from '../world/coords.js';

export const ROOF_MAX_WALL_DISTANCE = 6;

// Module-scoped scratch bitmaps, resized on demand. Both are cleared at the
// top of each runAutoRoof call; the `roofable` buffer is also cleared between
// rooms within the same call.
let _pending = new Uint8Array(0);
let _roofable = new Uint8Array(0);
/** @type {number[]} */
const _roofableTiles = [];

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} _board  kept for future use
 * @param {import('./rooms.js').RoomRegistry} rooms
 */
export function runAutoRoof(world, grid, _board, rooms) {
  const size = grid.W * grid.H;
  if (_pending.length < size) {
    _pending = new Uint8Array(size);
    _roofable = new Uint8Array(size);
  } else {
    _pending.fill(0, 0, size);
  }
  for (const { components } of world.query(['BuildSite', 'TileAnchor'])) {
    if (components.BuildSite.kind !== 'roof') continue;
    const a = components.TileAnchor;
    _pending[a.j * grid.W + a.i] = 1;
  }

  for (const room of rooms.rooms.values()) {
    // Roofable tiles = interior ∪ the walls/doors that enclose them, so the
    // room's perimeter is covered too. Walls and doors can carry a roof bit —
    // the roof sits above, doesn't conflict with the occupant.
    //
    // 8-way scan (not just ortho) so diagonal corner walls get included — a
    // rectangular room's corner wall only touches interior tiles diagonally.
    _roofableTiles.length = 0;
    for (const tileIdx of room.tiles) {
      if (_roofable[tileIdx] === 0) {
        _roofable[tileIdx] = 1;
        _roofableTiles.push(tileIdx);
      }
      const i = tileIdx % grid.W;
      const j = (tileIdx - i) / grid.W;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = i + di;
          const nj = j + dj;
          if (!grid.inBounds(ni, nj)) continue;
          const nidx = grid.idx(ni, nj);
          if ((grid.wall[nidx] !== 0 || grid.door[nidx] !== 0) && _roofable[nidx] === 0) {
            _roofable[nidx] = 1;
            _roofableTiles.push(nidx);
          }
        }
      }
    }
    for (const tileIdx of _roofableTiles) {
      _roofable[tileIdx] = 0;
      if (grid.roof[tileIdx] !== 0) continue;
      if (grid.ignoreRoof[tileIdx] !== 0) continue;
      if (_pending[tileIdx] !== 0) continue;
      const i = tileIdx % grid.W;
      const j = (tileIdx - i) / grid.W;
      if (!structureWithinChebyshev(grid, i, j, ROOF_MAX_WALL_DISTANCE)) continue;
      const w = tileToWorld(i, j, grid.W, grid.H);
      world.spawn({
        BuildSite: {
          kind: 'roof',
          requiredKind: 'wood',
          required: 0,
          delivered: 0,
          buildJobId: 0,
          progress: 0,
        },
        BuildSiteViz: {},
        TileAnchor: { i, j },
        Position: { x: w.x, y: grid.getElevation(i, j), z: w.z },
      });
      _pending[tileIdx] = 1;
    }
  }
}

const ORTHO = /** @type {const} */ ([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);

/**
 * True if (i,j) satisfies the roof support + reach rule:
 *   - orthogonally adjacent to an existing wall or roof, AND
 *   - within ROOF_MAX_WALL_DISTANCE Chebyshev of at least one wall.
 * The adjacency check uses existing walls/roofs only (not blueprints) — auto-
 * roof grows roofs outward along a frontier of built tiles.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 */
export function roofIsSupported(grid, i, j) {
  let touching = false;
  for (const [di, dj] of ORTHO) {
    const ni = i + di;
    const nj = j + dj;
    if (!grid.inBounds(ni, nj)) continue;
    if (grid.isWall(ni, nj) || grid.isDoor(ni, nj) || grid.isRoof(ni, nj)) {
      touching = true;
      break;
    }
  }
  if (!touching) return false;
  return structureWithinChebyshev(grid, i, j, ROOF_MAX_WALL_DISTANCE);
}

/**
 * True if (i,j) has an orthogonal neighbor that's a wall or door — the
 * structural anchor that wall torches mount to and the seed condition for
 * the roof-support BFS.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 */
export function hasOrthoStructure(grid, i, j) {
  for (const [di, dj] of ORTHO) {
    const ni = i + di;
    const nj = j + dj;
    if (!grid.inBounds(ni, nj)) continue;
    if (grid.isWall(ni, nj) || grid.isDoor(ni, nj)) return true;
  }
  return false;
}

/**
 * Pure-grid BFS returning the set of roof tile indices that are structurally
 * connected to a wall or door — either sitting on one, orthogonally adjacent
 * to one, or reachable via an ortho chain of other roof tiles that do.
 *
 * Consumers:
 *   - roofCollapse: any roof NOT in this set has lost its support and collapses.
 *   - roofInstancer: roofs in this set inherit wall color; isolated patches
 *     fall back to biome color.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {Set<number>}  tile indices (grid.idx)
 */
export function findSupportedRoofTiles(grid) {
  const { W, H, roof } = grid;
  /** @type {Set<number>} */
  const supported = new Set();
  /** @type {number[]} */
  const frontier = [];
  const size = W * H;
  for (let k = 0; k < size; k++) {
    if (roof[k] === 0) continue;
    const i = k % W;
    const j = (k - i) / W;
    // Seed: roof tile is on a wall/door OR any ortho neighbor is.
    if (grid.isWall(i, j) || grid.isDoor(i, j) || hasOrthoStructure(grid, i, j)) {
      supported.add(k);
      frontier.push(k);
    }
  }
  while (frontier.length > 0) {
    const k = /** @type {number} */ (frontier.pop());
    const i = k % W;
    const j = (k - i) / W;
    for (const [di, dj] of ORTHO) {
      const ni = i + di;
      const nj = j + dj;
      if (!grid.inBounds(ni, nj)) continue;
      if (!grid.isRoof(ni, nj)) continue;
      const nidx = grid.idx(ni, nj);
      if (supported.has(nidx)) continue;
      supported.add(nidx);
      frontier.push(nidx);
    }
  }
  return supported;
}

/**
 * True if any wall or door tile sits within Chebyshev distance `r` of (i,j).
 * Doors count alongside walls — they're part of the enclosing structure so
 * roofs can sit on them and roofs adjacent to isolated doors still find reach.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j @param {number} r
 */
export function structureWithinChebyshev(grid, i, j, r) {
  const i0 = Math.max(0, i - r);
  const i1 = Math.min(grid.W - 1, i + r);
  const j0 = Math.max(0, j - r);
  const j1 = Math.min(grid.H - 1, j + r);
  for (let jj = j0; jj <= j1; jj++) {
    for (let ii = i0; ii <= i1; ii++) {
      if (grid.isWall(ii, jj) || grid.isDoor(ii, jj)) return true;
    }
  }
  return false;
}
