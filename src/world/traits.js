/**
 * Colonist trait registry.
 *
 * Traits are small personality markers attached to an Identity. Each trait
 * has a visible chip in the info UI and may drive gameplay effects — for
 * now only `nameFont` (handwriting rendering) is wired, but the shape is
 * extensible so future traits can tweak job priorities, stat modifiers,
 * social compatibility, etc.
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
 * @property {string} nameFont     css font-family stack applied when the colonist's name renders
 * @property {number} [nameFontScale] multiplier on the rendered font size (default 1). Rock
 *                                    Salt's glyphs are ~2× Caveat's at the same px, so Messy
 *                                    uses 0.5 to match visual weight across traits.
 * @property {TraitId[]} [conflicts] ids that can't co-occur with this trait
 */

/** @type {Record<TraitId, TraitDef>} */
const TRAIT_DEFS = {
  messy: {
    id: 'messy',
    label: 'Messy',
    description: 'Scrawls their name in a hurried, jagged hand. Leaves crumbs everywhere.',
    chipColor: '#d48a4a',
    nameFont: "'Rock Salt', 'Bradley Hand', 'Comic Sans MS', cursive",
    nameFontScale: 0.75,
    conflicts: ['snobby'],
  },
  snobby: {
    id: 'snobby',
    label: 'Snobby',
    description: 'Signs their name in elegant cursive. Looks down on instant coffee.',
    chipColor: '#b79cd9',
    nameFont: "'Great Vibes', 'Snell Roundhand', 'Apple Chancery', cursive",
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
 * Default handwriting font for untraited colonists. Caveat is a tidy, legible
 * hand — a neutral baseline that Messy (Rock Salt) and Snobby (Great Vibes)
 * deviate away from.
 */
const DEFAULT_NAME_FONT = "'Caveat', 'Bradley Hand', 'Segoe Script', cursive";

/**
 * Resolve the css font-family for a colonist's name based on their traits.
 * First matching trait wins; falls back to the default handwriting font.
 *
 * @param {string[]} traits
 * @param {string} [fallback]
 */
export function nameFontFor(traits, fallback = DEFAULT_NAME_FONT) {
  for (const t of traits) {
    const def = TRAIT_DEFS[/** @type {TraitId} */ (t)];
    if (def?.nameFont) return def.nameFont;
  }
  return fallback;
}

/**
 * Size multiplier for the handwriting font — lets traits compensate for
 * font-metric differences (Rock Salt renders much taller than Caveat at the
 * same px size). First matching trait wins; default is 1.
 *
 * @param {string[]} traits
 */
export function nameFontScaleFor(traits) {
  for (const t of traits) {
    const def = TRAIT_DEFS[/** @type {TraitId} */ (t)];
    if (def?.nameFontScale) return def.nameFontScale;
  }
  return 1;
}

/** @param {string} id */
export function traitDef(id) {
  return TRAIT_DEFS[/** @type {TraitId} */ (id)] ?? null;
}
