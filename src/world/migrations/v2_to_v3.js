/**
 * v2 → v3 migration.
 *
 * v2 cows only persisted name/position/hunger. v3 adds their active Job and
 * Path so a saved colony resumes right where it left off. Old v2 cows get an
 * idle job and empty path — same visible result as v2's "drop in and start
 * wandering" behavior.
 */

/** @type {import('./index.js').Migration} */
export const v2_to_v3 = {
  from: 2,
  to: 3,
  run(state) {
    const cows = Array.isArray(state.cows) ? state.cows : [];
    return {
      ...state,
      version: 3,
      cows: cows.map((c) => ({
        ...c,
        job: c.job ?? { kind: 'none', state: 'idle', payload: {} },
        path: c.path ?? { steps: [], index: 0 },
      })),
    };
  },
};
