/**
 * v3 → v4 migration.
 *
 * Adds stockpile tile data (Uint8 array sized W*H, all zero for pre-v4
 * saves) and a per-cow inventory slot (starts empty). Slice B of Phase 4
 * introduces both.
 */

/** @type {import('./index.js').Migration} */
export const v3_to_v4 = {
  from: 3,
  to: 4,
  run(state) {
    const cows = Array.isArray(state.cows) ? state.cows : [];
    const tg = state.tileGrid ?? { W: 0, H: 0, elevation: [], biome: [] };
    const stockpile = Array.isArray(tg.stockpile) ? tg.stockpile : new Array(tg.W * tg.H).fill(0);
    return {
      ...state,
      version: 4,
      tileGrid: { ...tg, stockpile },
      cows: cows.map((c) => ({
        ...c,
        inventory: c.inventory ?? { itemKind: null },
      })),
    };
  },
};
