/**
 * v22 → v23 migration.
 *
 * Furnaces gained internal `stored` (supply inputs) and `outputs` (finished
 * goods awaiting haul) arrays. Previously supply landed as a forbidden Item
 * on the work-spot tile and output also spawned there. Existing saves have
 * nothing inside yet — default both to [].
 */

/** @type {import('./index.js').Migration} */
export const v22_to_v23 = {
  from: 22,
  to: 23,
  run(state) {
    const furnaces = (state.furnaces ?? []).map(
      /** @param {any} f */ (f) => ({ ...f, stored: f.stored ?? [], outputs: f.outputs ?? [] }),
    );
    return { ...state, version: 23, furnaces };
  },
};
