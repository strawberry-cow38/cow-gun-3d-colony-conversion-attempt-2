/**
 * v23 → v24 migration.
 *
 * Adds the easel workstation + painting item. No existing data needs
 * transformation — default both lists to empty for saves from before easels
 * existed.
 */

/** @type {import('./index.js').Migration} */
export const v23_to_v24 = {
  from: 23,
  to: 24,
  run(state) {
    return { ...state, version: 24, easels: state.easels ?? [], paintings: state.paintings ?? [] };
  },
};
