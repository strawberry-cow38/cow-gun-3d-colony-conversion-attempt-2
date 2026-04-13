/**
 * v6 → v7 migration.
 *
 * Cows have a `drafted` flag now — drafted cows opt out of autonomous AI
 * and only move on explicit player orders. Pre-v7 saves predate drafting,
 * so everyone is free.
 */

/** @type {import('./index.js').Migration} */
export const v6_to_v7 = {
  from: 6,
  to: 7,
  run(state) {
    const cows = Array.isArray(state.cows) ? state.cows : [];
    return {
      ...state,
      version: 7,
      cows: cows.map((c) => ({
        ...c,
        drafted: typeof c.drafted === 'boolean' ? c.drafted : false,
      })),
    };
  },
};
