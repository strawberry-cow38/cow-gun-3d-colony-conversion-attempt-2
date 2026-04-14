/**
 * Boulder registry: static minable nodes. Boulders do not grow or respawn —
 * they sit forever until a cow mines them, yielding a fixed item count and
 * despawning. Spawn biased toward STONE biome at world gen; if that's full,
 * grass/dirt is allowed too.
 */

export const BOULDER_KINDS = /** @type {const} */ (['stone', 'metal', 'coal']);

/** @type {Record<string, { item: string, yield: number }>} */
export const BOULDER_LOOT = {
  stone: { item: 'stone', yield: 20 },
  metal: { item: 'metal_ore', yield: 20 },
  coal: { item: 'coal', yield: 20 },
};

/**
 * @type {Record<string, {
 *   color: number,
 *   scale: [number, number, number],
 * }>}
 */
export const BOULDER_VISUALS = {
  stone: { color: 0x9aa0a6, scale: [1.0, 1.0, 1.0] },
  metal: { color: 0xc7b98a, scale: [0.95, 0.9, 0.95] },
  coal: { color: 0x2f2f35, scale: [1.05, 0.85, 1.05] },
};
