/**
 * v29 → v30 migration.
 *
 * Adds `cow.opinions` — per-cow sparse opinion map used by the social /
 * chit-chat system. Older saves start with empty opinions so existing
 * colonies aren't pre-seeded with relationships they didn't earn.
 */

/** @type {import('./index.js').Migration} */
export const v29_to_v30 = {
  from: 29,
  to: 30,
  run(state) {
    const cows = Array.isArray(state.cows) ? state.cows : [];
    const migratedCows = cows.map((c) => ({
      ...c,
      opinions: c.opinions ?? { scores: {}, last: {}, chats: 0 },
    }));
    return { ...state, version: 30, cows: migratedCows };
  },
};
