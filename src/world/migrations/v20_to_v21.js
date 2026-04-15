/**
 * v20 → v21 migration.
 *
 * Adds the Furnace production building. Older saves had no furnace concept,
 * so seed an empty list — every existing save just had no furnaces placed.
 */

/** @type {import('./index.js').Migration} */
export const v20_to_v21 = {
  from: 20,
  to: 21,
  run(state) {
    return { ...state, version: 21, furnaces: state.furnaces ?? [] };
  },
};
