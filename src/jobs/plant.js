/**
 * Plant job: cow walks to a tilled, zoned, unplanted tile and places a
 * seedling. On completion spawns a Crop entity with growth=0 at that tile.
 * Posted by the farm poster on tilled+zoned tiles without a Crop entity.
 *
 * Payload on JobBoard: { i, j, kind }  (kind = crop name, e.g. 'corn')
 * Job state on cow:
 *   'pathing'  → request path TO the tile itself.
 *   'walking'  → follow the path.
 *   'planting' → ticksRemaining decrements each tick; at 0, spawn + finish.
 */

export const PLANT_TICKS = 45; // 1.5 seconds at 30Hz
