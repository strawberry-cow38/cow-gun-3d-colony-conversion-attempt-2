/**
 * Crop registry. One place to look up growth time, stage visuals, and the
 * mapping from farmZone tile ids (1..N) back to the crop kind name.
 *
 * To add a crop: extend CROP_KINDS + CROP_ID_FOR_KIND (append — ids are
 * persisted in the farmZone bitmap) and register the growth tick + palette.
 * No migration needed; unknown ids fall back gracefully to null.
 */

export const CROP_KINDS = /** @type {const} */ (['corn', 'carrot', 'potato']);

/**
 * Total ticks of sunlit growth to reach the final stage. At 30Hz, 900 ticks
 * ≈ 30s of real time under full sun / no roof.
 *
 * @type {Record<string, number>}
 */
export const CROP_GROWTH_TICKS = {
  corn: 900,
  carrot: 1200,
  potato: 1500,
};

/** Number of visible growth stages (0..CROP_STAGES-1). Stage = floor(growth / stageSize). */
export const CROP_STAGES = 4;

/** Sun fraction (0..1) needed for a crop tile to tick growth. 51% — torches cap at 50%. */
export const SUN_GROWTH_THRESHOLD = 0.51;

/**
 * farmZone value (uint8) → crop kind. 0 means "no zone".
 * @type {Record<number, string>}
 */
export const KIND_FOR_CROP_ID = {
  1: 'corn',
  2: 'carrot',
  3: 'potato',
};

/**
 * Inverse of KIND_FOR_CROP_ID.
 * @type {Record<string, number>}
 */
export const CROP_ID_FOR_KIND = {
  corn: 1,
  carrot: 2,
  potato: 3,
};

/**
 * Per-kind visuals. Picker UI shows the icon + label; the instancer pulls
 * stem/ripe colors and the scale triple (horizontal, vertical, horizontal).
 *
 * Hex colors here are the same values the renderer consumes — kept in the
 * registry so the HUD and the renderer can't drift apart on what "carrot
 * green" looks like.
 *
 * @type {Record<string, { label: string, icon: string, stemColor: number, ripeColor: number, scale: [number, number, number] }>}
 */
export const CROP_VISUALS = {
  corn: {
    label: 'Corn',
    icon: '🌽',
    stemColor: 0x3a7a2a,
    ripeColor: 0xd9c24a,
    scale: [1, 1, 1],
  },
  carrot: {
    label: 'Carrot',
    icon: '🥕',
    stemColor: 0x3f8a34,
    ripeColor: 0xe07b2a,
    scale: [1.15, 0.55, 1.15],
  },
  potato: {
    label: 'Potato',
    icon: '🥔',
    stemColor: 0x476a2a,
    ripeColor: 0x8a5a2a,
    scale: [1.35, 0.4, 1.35],
  },
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
