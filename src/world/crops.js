/**
 * Crop registry. One place to look up growth time, stage visuals, and the
 * mapping from farmZone tile ids (1..N) back to the crop kind name.
 *
 * Phase 2 ships with corn only — carrots/potatoes are reserved ids that will
 * be wired up in phase 3 along with the per-crop picker.
 */

export const CROP_KINDS = /** @type {const} */ (['corn']);

/**
 * Total ticks of sunlit growth to reach the final stage. ~30 seconds of
 * useful sunlight at 30Hz; the growth system only increments the counter
 * when the tile's sun meets SUN_GROWTH_THRESHOLD AND the tile isn't roofed,
 * so real-world wall time is longer than 30s depending on day/night + roofing.
 *
 * @type {Record<string, number>}
 */
export const CROP_GROWTH_TICKS = {
  corn: 900,
};

/** Number of visible growth stages (0..CROP_STAGES-1). Stage = floor(growth / stageSize). */
export const CROP_STAGES = 4;

/** Sun fraction (0..1) needed for a crop tile to tick growth. 51% — torches cap at 50%. */
export const SUN_GROWTH_THRESHOLD = 0.51;

/** farmZone value (uint8) → crop kind. 0 means "no zone". */
/** @type {Record<number, string>} */
export const KIND_FOR_CROP_ID = {
  1: 'corn',
};

/** Inverse of KIND_FOR_CROP_ID. */
/** @type {Record<string, number>} */
export const CROP_ID_FOR_KIND = {
  corn: 1,
};

/** @param {number} id */
export function cropKindFor(id) {
  return KIND_FOR_CROP_ID[id] ?? null;
}

/** @param {string} kind @param {number} growthTicks */
export function cropStageFor(kind, growthTicks) {
  const total = CROP_GROWTH_TICKS[kind] ?? 0;
  if (total <= 0) return CROP_STAGES - 1;
  const raw = Math.floor((growthTicks / total) * CROP_STAGES);
  return Math.max(0, Math.min(CROP_STAGES - 1, raw));
}

/** @param {string} kind @param {number} growthTicks */
export function cropIsReady(kind, growthTicks) {
  return growthTicks >= (CROP_GROWTH_TICKS[kind] ?? Number.POSITIVE_INFINITY);
}
