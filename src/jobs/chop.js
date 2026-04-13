/**
 * Chop job: cow walks to a tile adjacent to a marked tree, hacks at it for
 * CHOP_TICKS, tree despawns and drops a wood item on its tile.
 *
 * Payload on JobBoard: { i, j, treeId }  (i,j = tree's tile)
 * Job state on cow:
 *   'pathing'   → request path to an adjacent walkable tile. If no path, give up.
 *   'chopping'  → ticksRemaining decrements each tick; at 0, finish job.
 *   'done'      → sentinel to let brain clear the job back to none.
 *
 * If the target tree despawns before we arrive (e.g. removed by another
 * system), the job is abandoned cleanly.
 */

export const CHOP_TICKS = 90; // 3 seconds at 30Hz

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
 * First walkable adjacent tile to (i, j), preferring cardinals. Returns null
 * if every neighbor is blocked.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {number} i @param {number} j
 */
export function findAdjacentWalkable(grid, walkable, i, j) {
  for (const [di, dj] of NBRS) {
    const ni = i + di;
    const nj = j + dj;
    if (grid.inBounds(ni, nj) && walkable(grid, ni, nj)) return { i: ni, j: nj };
  }
  return null;
}
