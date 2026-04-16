/**
 * v33 → v34 migration.
 *
 * Adds per-cow `health` to the save: a fresh, empty Health record for every
 * existing cow so old saves keep loading without any injury state.
 */

/** @type {import('./index.js').Migration} */
export const v33_to_v34 = {
  from: 33,
  to: 34,
  run(state) {
    const cows = Array.isArray(state.cows) ? state.cows : [];
    return {
      ...state,
      version: 34,
      cows: cows.map((c) => ({
        ...c,
        health: c.health ?? { injuries: [], nextInjuryId: 1, dead: false },
      })),
    };
  },
};
