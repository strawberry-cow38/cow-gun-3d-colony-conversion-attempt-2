/**
 * Till job: cow walks onto a farm-zoned tile, breaks the ground into planting
 * rows, and flips the grid's `tilled` bit. Posted by the farm poster for every
 * zoned-but-unworked tile.
 *
 * Payload on JobBoard: { i, j }  (tile to till; cow stands on it)
 * Job state on cow:
 *   'pathing'  → request path TO the tile itself (farm zones are walkable).
 *   'walking'  → follow the path.
 *   'tilling'  → ticksRemaining decrements each tick; at 0, finish.
 */

export const TILL_TICKS = 60; // 2 seconds at 30Hz — quicker than chop, slower than pickup
