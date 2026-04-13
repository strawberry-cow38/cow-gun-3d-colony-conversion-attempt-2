/**
 * v5 → v6 migration.
 *
 * Items now have a `count` + `capacity` field (one entity = one stack).
 * Pre-v6 saves treated items as singletons, so migrate them to count=1 with
 * a capacity looked up from the kind registry at load time.
 */

import { maxStack } from '../items.js';

/** @type {import('./index.js').Migration} */
export const v5_to_v6 = {
  from: 5,
  to: 6,
  run(state) {
    const items = Array.isArray(state.items) ? state.items : [];
    return {
      ...state,
      version: 6,
      items: items.map((it) => ({
        ...it,
        count: typeof it.count === 'number' ? it.count : 1,
        capacity: typeof it.capacity === 'number' ? it.capacity : maxStack(it.kind),
      })),
    };
  },
};
