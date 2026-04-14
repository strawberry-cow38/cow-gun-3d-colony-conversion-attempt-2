/**
 * v17 → v18 migration.
 *
 * Trees gained `kind` (birch/pine/oak/maple) and `growth` (0..1). Pre-v18
 * saves had none of that — every tree was implicitly a fully-grown oak, so
 * that's what we default legacy entries to.
 */

/** @type {import('./index.js').Migration} */
export const v17_to_v18 = {
  from: 17,
  to: 18,
  run(state) {
    return {
      ...state,
      version: 18,
      trees: (state.trees ?? []).map((t) => ({
        ...t,
        kind: t.kind ?? 'oak',
        growth: typeof t.growth === 'number' ? t.growth : 1,
      })),
    };
  },
};
