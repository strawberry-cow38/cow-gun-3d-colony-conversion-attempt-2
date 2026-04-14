/**
 * Tree registry, mirroring crops.js. To add a kind: append to TREE_KINDS and
 * register yield + growth duration + visuals below; old saves migrate
 * forward with a default kind.
 */

export const TREE_KINDS = /** @type {const} */ (['birch', 'pine', 'oak', 'maple']);

/** Below this growth fraction, chopping yields 0 wood. */
export const TREE_MIN_YIELD_GROWTH = 0.5;

/** @type {Record<string, number>} */
export const TREE_MAX_WOOD = {
  birch: 14,
  pine: 10,
  oak: 28,
  maple: 20,
};

/** Long-tier ticks of growth to reach maturity. @type {Record<string, number>} */
export const TREE_GROWTH_TICKS = {
  birch: 2400,
  pine: 3600,
  oak: 6400,
  maple: 3200,
};

/**
 * @type {Record<string, {
 *   trunkColor: number,
 *   canopyColor: number,
 *   trunkScale: [number, number, number],
 *   canopyScale: [number, number, number],
 * }>}
 */
export const TREE_VISUALS = {
  birch: {
    trunkColor: 0xe8e2d4,
    canopyColor: 0x9fcc64,
    trunkScale: [0.75, 1.15, 0.75],
    canopyScale: [0.85, 1.0, 0.85],
  },
  pine: {
    trunkColor: 0x4a2f1c,
    canopyColor: 0x1d4d2a,
    trunkScale: [0.9, 0.75, 0.9],
    canopyScale: [0.75, 1.6, 0.75],
  },
  oak: {
    trunkColor: 0x5a3820,
    canopyColor: 0x2e6f3a,
    trunkScale: [1.3, 1.1, 1.3],
    canopyScale: [1.3, 1.05, 1.3],
  },
  maple: {
    trunkColor: 0x7d5a3c,
    canopyColor: 0xc8632a,
    trunkScale: [1.0, 1.0, 1.0],
    canopyScale: [1.1, 1.0, 1.1],
  },
};

/** @param {string} kind @param {number} growth 0..1 */
export function woodYieldFor(kind, growth) {
  if (growth < TREE_MIN_YIELD_GROWTH) return 0;
  const max = TREE_MAX_WOOD[kind] ?? 0;
  const span = 1 - TREE_MIN_YIELD_GROWTH;
  const t = (growth - TREE_MIN_YIELD_GROWTH) / span;
  return Math.max(0, Math.round(max * t));
}

/** @param {() => number} [rng] */
export function randomTreeKind(rng = Math.random) {
  return TREE_KINDS[Math.floor(rng() * TREE_KINDS.length)];
}

/** Saplings render at 30% size, mature at 100%. @param {number} growth 0..1 */
export function growthScale(growth) {
  return 0.3 + 0.7 * Math.max(0, Math.min(1, growth));
}
