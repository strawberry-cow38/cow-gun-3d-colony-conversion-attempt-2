/**
 * v21 → v22 migration.
 *
 * Cow inventory shifted from a single-slot `{ itemKind: string|null }` to a
 * multi-stack `{ items: { kind, count }[] }` to support 60kg multi-item
 * carrying. Old itemKind=null becomes items=[]; old itemKind="wood" becomes
 * items=[{kind:"wood",count:1}] since the legacy slot held exactly one unit.
 */

/** @type {import('./index.js').Migration} */
export const v21_to_v22 = {
  from: 21,
  to: 22,
  run(state) {
    const cows = (state.cows ?? []).map(
      /** @param {any} c */ (c) => {
        const legacy = c.inventory?.itemKind ?? null;
        const items = legacy ? [{ kind: legacy, count: 1 }] : (c.inventory?.items ?? []);
        return { ...c, inventory: { items } };
      },
    );
    return { ...state, version: 22, cows };
  },
};
