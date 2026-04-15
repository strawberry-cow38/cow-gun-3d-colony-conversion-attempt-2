/**
 * Cow spawning helpers: primitive `spawnCowAt` + `spawnInitialCows` wrapper
 * and the BFS-outward `nearestFreeTile` both operate only on world/grid so
 * they live outside the main boot module.
 */

import { tileToWorld } from '../world/coords.js';
import { pickCowName } from '../world/cowNames.js';

/**
 * BFS outward from (i,j) to the nearest non-blocked in-bounds tile. Used so
 * cow spawn never lands on a tree/rock. Returns null only if the whole grid
 * is blocked, which shouldn't happen.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 */
export function nearestFreeTile(grid, i, j) {
  const seen = new Uint8Array(grid.W * grid.H);
  const queue = [{ i, j }];
  seen[j * grid.W + i] = 1;
  let head = 0;
  while (head < queue.length) {
    const t = queue[head++];
    if (grid.inBounds(t.i, t.j) && !grid.isBlocked(t.i, t.j)) return t;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = t.i + di;
      const nj = t.j + dj;
      if (ni < 0 || nj < 0 || ni >= grid.W || nj >= grid.H) continue;
      const idx = nj * grid.W + ni;
      if (seen[idx]) continue;
      seen[idx] = 1;
      queue.push({ i: ni, j: nj });
    }
  }
  return null;
}

/**
 * Spawn one cow on the nearest free tile to (i, j). No-op if the request is
 * out of bounds or the whole map is blocked.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 */
export function spawnCowAt(world, grid, i, j) {
  if (!grid.inBounds(i, j)) return;
  const placed = nearestFreeTile(grid, i, j);
  if (!placed) return;
  const w = tileToWorld(placed.i, placed.j, grid.W, grid.H);
  const y = grid.getElevation(placed.i, placed.j);
  world.spawn({
    Cow: { drafted: false },
    Position: { x: w.x, y, z: w.z },
    PrevPosition: { x: w.x, y, z: w.z },
    Velocity: { x: 0, y: 0, z: 0 },
    Hunger: { value: 1 },
    Brain: { name: pickCowName() },
    Job: { kind: 'none', state: 'idle', payload: {} },
    Path: { steps: [], index: 0 },
    Inventory: { items: [] },
    CowViz: {},
  });
}

/**
 * Scatter `count` cows within a few tiles of grid center. Each call hits
 * `spawnCowAt`, which BFSes to free ground.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} count
 */
export function spawnInitialCows(world, grid, count) {
  for (let n = 0; n < count; n++) {
    const i = Math.floor(grid.W / 2 + (Math.random() * 6 - 3));
    const j = Math.floor(grid.H / 2 + (Math.random() * 6 - 3));
    spawnCowAt(world, grid, i, j);
  }
}
