/**
 * Colonist trait registry.
 *
 * Traits are small personality markers attached to an Identity. Each trait
 * has a visible chip in the info UI and may drive gameplay effects. The
 * shape is extensible so future traits can tweak job priorities, stat
 * modifiers, social compatibility, etc.
 *
 * Traits are rolled at spawn. A colonist carries 0..MAX_TRAITS_PER_COLONIST
 * of them. The spawner draws without replacement and respects `conflicts`
 * so contradictory pairs can't co-occur.
 */

/**
 * @typedef {'messy' | 'snobby'} TraitId
 *
 * @typedef TraitDef
 * @property {TraitId} id
 * @property {string} label        short label shown on the chip
 * @property {string} description  long-form explanation for hover/click
 * @property {string} chipColor    css color for the chip accent
 * @property {TraitId[]} [conflicts] ids that can't co-occur with this trait
 */

/** @type {Record<TraitId, TraitDef>} */
const TRAIT_DEFS = {
  messy: {
    id: 'messy',
    label: 'Messy',
    description: 'Leaves crumbs everywhere. A bit careless.',
    chipColor: '#d48a4a',
    conflicts: ['snobby'],
  },
  snobby: {
    id: 'snobby',
    label: 'Snobby',
    description: 'Looks down on instant coffee.',
    chipColor: '#b79cd9',
    conflicts: ['messy'],
  },
};

const ALL_TRAIT_IDS = /** @type {TraitId[]} */ (Object.keys(TRAIT_DEFS));
export const MAX_TRAITS_PER_COLONIST = 2;

/**
 * Roll 0..MAX random traits, respecting conflicts. Returns trait ids in
 * registry order (deterministic-ish for UI stability).
 *
 * 40% chance of one trait, 15% chance of two, 45% chance of none.
 */
export function rollTraits() {
  const r = Math.random();
  const target = r < 0.45 ? 0 : r < 0.85 ? 1 : 2;
  if (target === 0) return [];

  const pool = [...ALL_TRAIT_IDS];
  /** @type {TraitId[]} */
  const picked = [];
  while (picked.length < target && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    const cand = pool.splice(idx, 1)[0];
    const def = TRAIT_DEFS[cand];
    const clashes = (def.conflicts ?? []).some((c) => picked.includes(c));
    if (!clashes) picked.push(cand);
  }
  return ALL_TRAIT_IDS.filter((t) => picked.includes(t));
}

/**
 * Resolve the css font-family for a colonist's name. Previously traits drove
 * per-colonist handwriting fonts, but they proved hard to read — everyone
 * now uses the page's normal font.
 *
 * Kept as a function (rather than inlining `'inherit'`) so future traits can
 * reintroduce targeted font tweaks without rewiring callers.
 *
 * @param {string[]} _traits
 */
export function nameFontFor(_traits) {
  return 'inherit';
}

/**
 * Size multiplier for the colonist name font. With the handwriting fonts
 * retired there's no metric divergence to correct for — always 1.
 *
 * @param {string[]} _traits
 */
export function nameFontScaleFor(_traits) {
  return 1;
}

/** @param {string} id */
export function traitDef(id) {
  return TRAIT_DEFS[/** @type {TraitId} */ (id)] ?? null;
}
