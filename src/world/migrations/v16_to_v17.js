/**
 * v16 → v17 migration.
 *
 * Adds `forbidden: false` to every serialized item stack. Forbidden stacks
 * are player-locked — cows skip them for haul/eat jobs. Pre-v17 saves had no
 * such concept, so everything defaults to not forbidden.
 */

/** @type {import('./index.js').Migration} */
export const v16_to_v17 = {
  from: 16,
  to: 17,
  run(state) {
    return {
      ...state,
      version: 17,
      items: (state.items ?? []).map((it) => ({ ...it, forbidden: it.forbidden === true })),
    };
  },
};
