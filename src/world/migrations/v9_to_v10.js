/**
 * v9 → v10 migration.
 *
 * Introduces the torch system: a `torch` Uint8-equivalent array on the tile
 * grid (nonzero = finished torch on that tile, walkable + decorative) plus a
 * top-level `torches: [{ i, j }]` array for Torch entity rehydration. Pre-v10
 * saves have neither, so seed an empty bitmap + list.
 */

/** @type {import('./index.js').Migration} */
export const v9_to_v10 = {
  from: 9,
  to: 10,
  run(state) {
    const tileGrid = state.tileGrid ?? {};
    const area = (tileGrid.W ?? 0) * (tileGrid.H ?? 0);
    return {
      ...state,
      version: 10,
      tileGrid: {
        ...tileGrid,
        torch: Array.isArray(tileGrid.torch) ? tileGrid.torch : new Array(area).fill(0),
      },
      torches: Array.isArray(state.torches) ? state.torches : [],
    };
  },
};
