/**
 * v4 → v5 migration.
 *
 * Adds persisted `trees` and `items` arrays. Pre-v5 saves defaulted to a fresh
 * random tree scatter and no items; we migrate them to empty arrays so the
 * world loads bare rather than re-randomizing (the load path is responsible
 * for deciding whether to seed fresh trees when the array is empty).
 */

/** @type {import('./index.js').Migration} */
export const v4_to_v5 = {
  from: 4,
  to: 5,
  run(state) {
    return {
      ...state,
      version: 5,
      trees: Array.isArray(state.trees) ? state.trees : [],
      items: Array.isArray(state.items) ? state.items : [],
    };
  },
};
