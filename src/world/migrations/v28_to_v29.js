/**
 * v28 → v29 migration.
 *
 * Adds `tileGrid.flower` — a new per-tile uint8 seeding decorative flowers on
 * grass tiles. Rolls flowers on ~2% of eligible grass tiles so old saves
 * bloom on first load instead of staying barren until a world regen.
 */

/** @type {import('./index.js').Migration} */
export const v28_to_v29 = {
  from: 28,
  to: 29,
  run(state) {
    const tg = state.tileGrid;
    if (!tg || !Array.isArray(tg.biome)) return { ...state, version: 29 };
    if (Array.isArray(tg.flower) && tg.flower.length === tg.biome.length) {
      return { ...state, version: 29 };
    }
    const flower = new Array(tg.biome.length).fill(0);
    for (let k = 0; k < tg.biome.length; k++) {
      // GRASS = 0 — see tileGrid.js BIOME enum.
      if (tg.biome[k] !== 0) continue;
      const hasStructure =
        tg.wall?.[k] || tg.floor?.[k] || tg.roof?.[k] || tg.tilled?.[k] || tg.farmZone?.[k];
      if (hasStructure) continue;
      if (Math.random() < 0.02) flower[k] = 1 + Math.floor(Math.random() * 5);
    }
    return {
      ...state,
      version: 29,
      tileGrid: { ...tg, flower },
    };
  },
};
