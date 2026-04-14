/**
 * Harvest job: cow walks to a mature Crop entity, reaps it, and drops a food
 * item on the tile. Despawns the crop; keeps tilled=1 so the next farm-poster
 * tick queues a fresh plant on the same soil.
 *
 * Payload on JobBoard: { cropId, i, j }
 * Job state on cow:
 *   'pathing'     → request path TO the tile.
 *   'walking'     → follow the path.
 *   'harvesting'  → ticksRemaining decrements each tick; at 0, drop + despawn.
 */

export const HARVEST_TICKS = 45; // 1.5 seconds at 30Hz
