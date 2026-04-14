/**
 * v10 → v11 migration.
 *
 * Adds `decon: false, progress: 0` to every wall, door, and torch so the
 * deconstruct designator has a place to persist marks. Pre-v11 structures
 * were tag-only ({i, j}); upgrading preserves position and leaves them
 * unmarked.
 */

/** @type {import('./index.js').Migration} */
export const v10_to_v11 = {
  from: 10,
  to: 11,
  run(state) {
    const upgradeStruct = (/** @type {any[]} */ arr) =>
      (Array.isArray(arr) ? arr : []).map((s) => ({
        ...s,
        decon: s.decon === true,
        progress: typeof s.progress === 'number' ? s.progress : 0,
      }));
    return {
      ...state,
      version: 11,
      walls: upgradeStruct(state.walls),
      doors: upgradeStruct(state.doors),
      torches: upgradeStruct(state.torches),
    };
  },
};
