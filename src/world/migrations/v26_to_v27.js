/**
 * v26 → v27 migration.
 *
 * Default existing colonists to an empty traits array rather than rolling
 * fresh traits on load — re-rolling on every load would be disorienting.
 */

/** @type {import('./index.js').Migration} */
export const v26_to_v27 = {
  from: 26,
  to: 27,
  run(state) {
    const cows = Array.isArray(state.cows) ? state.cows : [];
    const upgradedCows = cows.map((/** @type {any} */ c) => {
      if (!c.identity) return c;
      if (Array.isArray(c.identity.traits)) return c;
      return {
        ...c,
        identity: { ...c.identity, traits: [] },
      };
    });
    return { ...state, version: 27, cows: upgradedCows };
  },
};
