/**
 * v13 → v14 migration.
 *
 * Adds the floor system. `tileGrid.floor` is a new per-tile bitmap, and a
 * top-level `floors` array holds the finished-floor entities. Pre-v14 saves
 * have neither — default both to empty so cows everywhere fall back to the
 * 85% off-floor speed.
 */

/** @type {import('./index.js').Migration} */
export const v13_to_v14 = {
  from: 13,
  to: 14,
  run(state) {
    const W = state.tileGrid?.W ?? 0;
    const H = state.tileGrid?.H ?? 0;
    return {
      ...state,
      version: 14,
      tileGrid: {
        ...state.tileGrid,
        floor: state.tileGrid?.floor ?? new Array(W * H).fill(0),
      },
      floors: state.floors ?? [],
    };
  },
};
