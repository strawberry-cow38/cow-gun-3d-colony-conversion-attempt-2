/**
 * Mine job: cow walks to a tile adjacent to a marked boulder, chips at it for
 * MINE_TICKS, boulder despawns and drops BOULDER_LOOT items on its tile.
 * Mirrors the chop job's shape so the brain can swap implementations with a
 * small switch.
 */

export const MINE_TICKS = 180; // 6 seconds at 30Hz — mining is slower than chop
