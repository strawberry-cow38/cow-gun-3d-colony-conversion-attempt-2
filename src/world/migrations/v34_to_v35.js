/**
 * v34 → v35 migration.
 *
 * Adds the `stoves` array to the save so pre-Stove-building saves still load.
 * Nothing to re-derive; any legacy save simply has zero stoves.
 */

/** @type {import('./index.js').Migration} */
export const v34_to_v35 = {
  from: 34,
  to: 35,
  run(state) {
    return {
      ...state,
      version: 35,
      stoves: Array.isArray(state.stoves) ? state.stoves : [],
    };
  },
};
