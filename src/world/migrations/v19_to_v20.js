/**
 * v19 → v20 migration.
 *
 * Adds `cutMarked` + `cutProgress` to trees and crops, tracking the new
 * Cuttable component the player drives via the cut-plants designator.
 * Legacy saves had no cut state at all, so default to false / 0.
 */

/** @type {import('./index.js').Migration} */
export const v19_to_v20 = {
  from: 19,
  to: 20,
  run(state) {
    const trees = (state.trees ?? []).map((t) => ({
      ...t,
      cutMarked: false,
      cutProgress: 0,
    }));
    const crops = (state.crops ?? []).map((c) => ({
      ...c,
      cutMarked: false,
      cutProgress: 0,
    }));
    return { ...state, version: 20, trees, crops };
  },
};
