/**
 * v18 → v19 migration.
 *
 * Adds the `boulders` array. Legacy saves simply get an empty list — no
 * boulders to retroactively scatter, the world just lacks them.
 */

/** @type {import('./index.js').Migration} */
export const v18_to_v19 = {
  from: 18,
  to: 19,
  run(state) {
    return {
      ...state,
      version: 19,
      boulders: state.boulders ?? [],
    };
  },
};
