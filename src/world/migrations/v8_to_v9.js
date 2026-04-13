/**
 * v8 → v9 migration.
 *
 * Introduces the door system: a `door` Uint8-equivalent array on the tile
 * grid (nonzero = finished door on that tile, walkable) plus a top-level
 * `doors: [{ i, j }]` array for Door entity rehydration. Pre-v9 saves have
 * neither, so seed an empty bitmap + list.
 */

/** @type {import('./index.js').Migration} */
export const v8_to_v9 = {
  from: 8,
  to: 9,
  run(state) {
    const tileGrid = state.tileGrid ?? {};
    const area = (tileGrid.W ?? 0) * (tileGrid.H ?? 0);
    return {
      ...state,
      version: 9,
      tileGrid: {
        ...tileGrid,
        door: Array.isArray(tileGrid.door) ? tileGrid.door : new Array(area).fill(0),
      },
      doors: Array.isArray(state.doors) ? state.doors : [],
    };
  },
};
