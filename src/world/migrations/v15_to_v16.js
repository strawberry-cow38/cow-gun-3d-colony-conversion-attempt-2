/**
 * v15 → v16 migration.
 *
 * Adds `crops: []` at the top level — crop ECS entities are now serialized.
 * v14_to_v15 already provided an initial crops array, but only when the save
 * went through that migration; hand-written test fixtures or saves that
 * somehow reach v15 without it still need the default guard here.
 */

/** @type {import('./index.js').Migration} */
export const v15_to_v16 = {
  from: 15,
  to: 16,
  run(state) {
    return {
      ...state,
      version: 16,
      crops: state.crops ?? [],
    };
  },
};
