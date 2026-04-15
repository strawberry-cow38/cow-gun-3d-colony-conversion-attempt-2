/**
 * v32 → v33 migration.
 *
 * Promotes the inner 13×13-shallow region of every v32 lake to DEEP_WATER so
 * old saves gain deep water retroactively. Cows can wade through shallow but
 * not deep.
 */

import { carveDeepWater } from '../tileGrid.js';

/** @type {import('./index.js').Migration} */
export const v32_to_v33 = {
  from: 32,
  to: 33,
  run(state) {
    const tg = state.tileGrid ?? {};
    const biome = Array.isArray(tg.biome) ? tg.biome.slice() : [];
    const W = tg.W ?? 0;
    const H = tg.H ?? 0;
    if (biome.length === W * H && W > 0 && H > 0) {
      carveDeepWater(biome, W, H);
    }
    return {
      ...state,
      version: 33,
      tileGrid: { ...tg, biome },
    };
  },
};
