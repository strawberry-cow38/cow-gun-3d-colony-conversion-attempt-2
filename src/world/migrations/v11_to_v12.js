/**
 * v11 → v12 migration.
 *
 * Adds roofs: a `roof` bitmap + `ignoreRoof` bitmap on the tile grid, and a
 * top-level `roofs: []` array for Roof entity rehydration. Pre-v12 saves have
 * none of these, so seed empties.
 */

/** @type {import('./index.js').Migration} */
export const v11_to_v12 = {
  from: 11,
  to: 12,
  run(state) {
    const tileGrid = state.tileGrid ?? {};
    const area = (tileGrid.W ?? 0) * (tileGrid.H ?? 0);
    return {
      ...state,
      version: 12,
      tileGrid: {
        ...tileGrid,
        roof: Array.isArray(tileGrid.roof) ? tileGrid.roof : new Array(area).fill(0),
        ignoreRoof: Array.isArray(tileGrid.ignoreRoof)
          ? tileGrid.ignoreRoof
          : new Array(area).fill(0),
      },
      roofs: Array.isArray(state.roofs) ? state.roofs : [],
    };
  },
};
