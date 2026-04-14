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
 * `roofIsSupported` / `wallWithinChebyshev` live here rather than in a render
 * module so jobs/haul.js can import them without pulling in THREE.
 */

import { tileToWorld } from '../world/coords.js';

export const ROOF_MAX_WALL_DISTANCE = 6;

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} _board  kept for future use
 * @param {import('./rooms.js').RoomRegistry} rooms
 */
export function runAutoRoof(world, grid, _board, rooms) {
  const pending = new Set();
  for (const { components } of world.query(['BuildSite', 'TileAnchor'])) {
    if (components.BuildSite.kind !== 'roof') continue;
    const a = components.TileAnchor;
    pending.add(a.j * grid.W + a.i);
  }

  for (const room of rooms.rooms.values()) {
    for (const tileIdx of room.tiles) {
      if (grid.roof[tileIdx] !== 0) continue;
      if (grid.ignoreRoof[tileIdx] !== 0) continue;
      if (pending.has(tileIdx)) continue;
      const i = tileIdx % grid.W;
      const j = (tileIdx - i) / grid.W;
      if (!wallWithinChebyshev(grid, i, j, ROOF_MAX_WALL_DISTANCE)) continue;
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
      pending.add(tileIdx);
    }
  }
}

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
  const orthoNbrs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let touching = false;
  for (const [di, dj] of orthoNbrs) {
    const ni = i + di;
    const nj = j + dj;
    if (!grid.inBounds(ni, nj)) continue;
    if (grid.isWall(ni, nj) || grid.isRoof(ni, nj)) {
      touching = true;
      break;
    }
  }
  if (!touching) return false;
  return wallWithinChebyshev(grid, i, j, ROOF_MAX_WALL_DISTANCE);
}

/**
 * True if any wall tile sits within Chebyshev distance `r` of (i,j).
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j @param {number} r
 */
export function wallWithinChebyshev(grid, i, j, r) {
  const i0 = Math.max(0, i - r);
  const i1 = Math.min(grid.W - 1, i + r);
  const j0 = Math.max(0, j - r);
  const j1 = Math.min(grid.H - 1, j + r);
  for (let jj = j0; jj <= j1; jj++) {
    for (let ii = i0; ii <= i1; ii++) {
      if (grid.isWall(ii, jj)) return true;
    }
  }
  return false;
}
