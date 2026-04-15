/**
 * Cut job: cow walks to a tile adjacent to a Cuttable entity (Tree, Crop, or
 * any future wild foliage), hacks/snips for CUT_TICKS, target despawns and
 * drops whatever yield it's currently worth — a sapling Tree yields 0 wood,
 * a ripe oak yields full wood; an unripe Crop yields 0 food, a mature one
 * yields its full haul.
 *
 * Distinct from chop/harvest because it's opt-in at any growth stage and
 * works across plant types, so the player can clear brush the AI would
 * otherwise refuse or ignore.
 */

export const CUT_TICKS = 60; // 2 seconds at 30Hz — faster than chop since
// it's mostly used on low-yield stuff that doesn't deserve a full 3s chop.
