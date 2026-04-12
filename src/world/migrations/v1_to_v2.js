/**
 * v1 → v2 migration.
 *
 * v1 stored only the tile grid. v2 adds a `cows` array so Phase 3's pawns
 * survive save/load. Old v1 saves get an empty cow list — when reloaded the
 * world is the same terrain but unpopulated.
 */

/** @type {import('./index.js').Migration} */
export const v1_to_v2 = {
  from: 1,
  to: 2,
  run(state) {
    return {
      ...state,
      version: 2,
      cows: [],
    };
  },
};
