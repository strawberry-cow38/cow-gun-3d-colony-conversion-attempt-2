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
export const ROOF_BUILD_TICKS = 30; // 1 second — roofs are light and resource-
//                                     free so they snap up fast.

/**
 * @param {string} kind
 */
export function buildTicksForKind(kind) {
  return kind === 'roof' ? ROOF_BUILD_TICKS : BUILD_TICKS;
}

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
 * If `blueprintTiles` (keyed by `j*W + i`) is provided, adjacent tiles that
 * are themselves pending blueprints are tried only as a last resort — keeps
 * builders from planting themselves on a neighbor wall's tile unless no
 * clean stand-spot exists.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {number} i @param {number} j
 * @param {Set<number>} [blueprintTiles]
 */
export function findBuildStandTile(grid, walkable, i, j, blueprintTiles) {
  /** @type {{ i: number, j: number } | null} */
  let fallback = null;
  for (const [di, dj] of NBRS) {
    const ni = i + di;
    const nj = j + dj;
    if (!grid.inBounds(ni, nj) || !walkable(grid, ni, nj)) continue;
    if (blueprintTiles?.has(nj * grid.W + ni)) {
      if (!fallback) fallback = { i: ni, j: nj };
      continue;
    }
    return { i: ni, j: nj };
  }
  return fallback;
}
