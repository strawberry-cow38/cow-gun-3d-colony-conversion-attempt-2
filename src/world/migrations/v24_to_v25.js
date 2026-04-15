/**
 * v24 → v25 migration.
 *
 * Adds installed wall art (paintings mounted on walls). Old saves have no
 * wall-mounted art — default the list to empty.
 */

/** @type {import('./index.js').Migration} */
export const v24_to_v25 = {
  from: 24,
  to: 25,
  run(state) {
    return { ...state, version: 25, wallArt: state.wallArt ?? [] };
  },
};
