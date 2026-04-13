/**
 * Build job: a cow walks to a tile adjacent to a BuildSite with all materials
 * delivered, hammers at it for BUILD_TICKS, the BuildSite converts into a Wall.
 *
 * Payload on JobBoard: { i, j, siteId }   (i, j = site's tile)
 * Payload on cow Job (kind='build'): { jobId, siteId, i, j, ticksRemaining }
 *
 * Build jobs are posted by the haul system the instant a BuildSite's delivered
 * count catches up to its requirement — they don't exist until the materials
 * are physically on the tile, so a builder never shows up to an empty site.
 */

export const BUILD_TICKS = 120; // 4 seconds at 30Hz — a bit slower than chop to
//                                 sell the heft of erecting a wall.

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
 * First walkable adjacent tile to (i, j), preferring cardinals. Mirrors
 * findAdjacentWalkable in chop.js — kept separate so the two call sites can
 * diverge later (e.g. builders care about reach orientation, choppers don't).
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {number} i @param {number} j
 */
export function findBuildStandTile(grid, walkable, i, j) {
  for (const [di, dj] of NBRS) {
    const ni = i + di;
    const nj = j + dj;
    if (grid.inBounds(ni, nj) && walkable(grid, ni, nj)) return { i: ni, j: nj };
  }
  return null;
}
