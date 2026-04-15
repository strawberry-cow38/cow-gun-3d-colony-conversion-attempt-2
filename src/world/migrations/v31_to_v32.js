/**
 * v31 → v32 migration.
 *
 * Adds the WATER biome. Any old save's interior sand (tiles with a 2-tile
 * sand buffer in all directions) becomes water so existing beaches grow
 * lakes retroactively.
 */

import { carveWaterLakes } from '../tileGrid.js';

/** @type {import('./index.js').Migration} */
export const v31_to_v32 = {
  from: 31,
  to: 32,
  run(state) {
    const tg = state.tileGrid ?? {};
    const biome = Array.isArray(tg.biome) ? tg.biome.slice() : [];
    const W = tg.W ?? 0;
    const H = tg.H ?? 0;
    if (biome.length === W * H && W > 0 && H > 0) {
      carveWaterLakes(biome, W, H);
    }
    return {
      ...state,
      version: 32,
      tileGrid: { ...tg, biome },
    };
  },
};
