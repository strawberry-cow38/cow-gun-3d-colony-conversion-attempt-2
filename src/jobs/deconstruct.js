/**
 * Deconstruct job: a cow walks adjacent to a finished Wall / Door / Torch, hammers
 * for DECONSTRUCT_TICKS, then despawns the entity, clears the tile bit, and drops
 * half the original resources (rounded) as a loose stack.
 *
 * Payload on JobBoard: { entityId, kind, i, j }
 * Payload on cow Job (kind='deconstruct'): { jobId, entityId, kind, i, j, ticksRemaining }
 *
 * For walls we stand adjacent; for doors and torches, the tile itself is
 * walkable so the cow can step right on. `findDeconstructStandTile` handles
 * both cases: on the tile for walkable kinds, adjacent for walls.
 */

export const DECONSTRUCT_TICKS = 90; // 3 seconds at 30Hz — faster than build.

const NBRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {string} kind
 * @param {number} i @param {number} j
 */
export function findDeconstructStandTile(grid, walkable, kind, i, j) {
  if (kind !== 'wall' && kind !== 'furnace') {
    // Doors, torches, floors are walkable; stand on the target tile itself.
    // Walls and furnaces block their own tile, so cow stands adjacent.
    if (grid.inBounds(i, j) && walkable(grid, i, j)) return { i, j };
  }
  for (const [di, dj] of NBRS) {
    const ni = i + di;
    const nj = j + dj;
    if (!grid.inBounds(ni, nj) || !walkable(grid, ni, nj)) continue;
    return { i: ni, j: nj };
  }
  return null;
}
