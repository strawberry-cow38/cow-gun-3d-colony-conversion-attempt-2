/**
 * v30 → v31 migration.
 *
 * Adds `identity.childhood` and `identity.profession` — the Y2K-era
 * backstory strings rolled once per colonist. Existing cows get a fresh
 * roll keyed off their stored title so prestige titles still land in a
 * fitting pool.
 */

import { pickChildhood, pickProfession } from '../backstories.js';

/** @type {import('./index.js').Migration} */
export const v30_to_v31 = {
  from: 30,
  to: 31,
  run(state) {
    const cows = Array.isArray(state.cows) ? state.cows : [];
    const migratedCows = cows.map((c) => {
      const id = c.identity ?? {};
      const title = id.title ?? 'Mx.';
      return {
        ...c,
        identity: {
          ...id,
          childhood: id.childhood ?? pickChildhood(title),
          profession: id.profession ?? pickProfession(title),
        },
      };
    });
    return { ...state, version: 31, cows: migratedCows };
  },
};
