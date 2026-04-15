/**
 * Flower kinds for the `flower` field on TileGrid (1..N; 0 = empty).
 *
 * Pure decoration: seeded at terrain-gen on a fraction of grass tiles, render
 * as instanced billboards, and also act as emitters for daytime butterfly
 * particles. Kinds exist only to give the meadow visual variety + per-kind
 * butterfly tint.
 */

/**
 * @typedef FlowerKind
 * @property {string} name         short label, for future info tooltips
 * @property {number} petalColor   hex tint applied to the instanced petal
 * @property {number} butterflyColor hex tint for butterflies spawned from this flower
 */

/** @type {FlowerKind[]} */
const FLOWER_KINDS = [
  { name: 'poppy', petalColor: 0xe8384f, butterflyColor: 0xf06a82 },
  { name: 'daisy', petalColor: 0xfff6d0, butterflyColor: 0xfff0a0 },
  { name: 'cornflower', petalColor: 0x5f8fe0, butterflyColor: 0x8ab8ff },
  { name: 'marigold', petalColor: 0xffb043, butterflyColor: 0xffd070 },
  { name: 'bluebell', petalColor: 0xa67ad8, butterflyColor: 0xc9a6f0 },
];

export const FLOWER_COUNT = FLOWER_KINDS.length;

/** @param {number} kind 1-indexed */
export function flowerKind(kind) {
  return FLOWER_KINDS[kind - 1] ?? FLOWER_KINDS[0];
}
