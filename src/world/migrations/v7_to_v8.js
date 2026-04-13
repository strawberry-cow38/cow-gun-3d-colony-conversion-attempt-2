/**
 * v7 → v8 migration.
 *
 * Introduces the wall system: BuildSite entities (designated-but-unbuilt
 * walls) and Wall entities (finished walls), plus a per-tile `wall` bitmap on
 * the tile grid. Pre-v8 saves have no walls, so we add empty arrays + a
 * zero-filled bitmap so the hydrator sees the new shape.
 */

/** @type {import('./index.js').Migration} */
export const v7_to_v8 = {
  from: 7,
  to: 8,
  run(state) {
    const tileGrid = state.tileGrid ?? {};
    const area = (tileGrid.W ?? 0) * (tileGrid.H ?? 0);
    return {
      ...state,
      version: 8,
      tileGrid: {
        ...tileGrid,
        wall: Array.isArray(tileGrid.wall) ? tileGrid.wall : new Array(area).fill(0),
      },
      buildSites: Array.isArray(state.buildSites) ? state.buildSites : [],
      walls: Array.isArray(state.walls) ? state.walls : [],
    };
  },
};
