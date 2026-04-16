/**
 * Per-cow work priorities: 7 categories, each either disabled (0) or assigned
 * a priority 1..8 (lower = sooner). Categories map to concrete job kinds via
 * CATEGORY_TO_KINDS — a single kind may belong to multiple categories
 * (install/uninstall are both haul + construction), in which case the cow
 * takes the job if ANY of its owning categories is enabled.
 *
 * The checkmark UI mode just flips between DEFAULT_PRIORITY and 0.
 * The 1-8 UI mode exposes the full ordering.
 */

/** @typedef {'haul'|'construction'|'crafting'|'mining'|'growing'|'cooking'|'art'} WorkCategory */

/** @type {WorkCategory[]} */
export const WORK_CATEGORIES = [
  'haul',
  'construction',
  'crafting',
  'mining',
  'growing',
  'cooking',
  'art',
];

export const WORK_CATEGORY_LABELS = /** @type {Record<WorkCategory, string>} */ ({
  haul: 'Haul',
  construction: 'Construct',
  crafting: 'Craft',
  mining: 'Mine',
  growing: 'Grow',
  cooking: 'Cook',
  art: 'Art',
});

const MIN_PRIORITY = 0;
export const MAX_PRIORITY = 8;
export const DEFAULT_PRIORITY = 4;

/**
 * Category → list of job `kind` strings it owns. Kinds may appear in multiple
 * categories (install/uninstall belong to both haul and construction).
 *
 * @type {Record<WorkCategory, string[]>}
 */
export const CATEGORY_TO_KINDS = {
  haul: ['haul', 'install', 'uninstall'],
  construction: ['build', 'deconstruct', 'deliver', 'install', 'uninstall'],
  crafting: ['supply'],
  mining: ['mine'],
  growing: ['chop', 'cut', 'till', 'plant', 'harvest'],
  cooking: ['cook'],
  art: ['paint'],
};

/**
 * Category → `SkillId` whose level gates the "enabled by default on spawn"
 * decision. `null` means the category has no backing skill yet and spawns
 * enabled unconditionally (haul = muscle, art = no art skill).
 *
 * @type {Record<WorkCategory, import('./skills.js').SkillId | null>}
 */
export const CATEGORY_TO_SKILL = {
  haul: null,
  construction: 'construction',
  crafting: 'crafting',
  mining: 'mining',
  growing: 'plants',
  cooking: 'cooking',
  art: null,
};

/** Inverted CATEGORY_TO_KINDS: job kind → list of categories that own it. */
export const KIND_TO_CATEGORIES = /** @type {Record<string, WorkCategory[]>} */ ({});
for (const cat of WORK_CATEGORIES) {
  for (const kind of CATEGORY_TO_KINDS[cat]) {
    if (!KIND_TO_CATEGORIES[kind]) KIND_TO_CATEGORIES[kind] = [];
    KIND_TO_CATEGORIES[kind].push(cat);
  }
}

/**
 * Skill level at which a colonist is competent enough to default-enable
 * a skill-gated category on spawn. Below this, the category defaults to 0
 * so the player decides when to let rookies learn via work.
 */
export const DEFAULT_SKILL_THRESHOLD = 3;

/**
 * Build a fresh WorkPriorities payload from a rolled Skills component. Called
 * on cow spawn and in save-load fallback paths. Pure.
 *
 * @param {{ levels?: Record<string, { level: number }> } | undefined} skills
 * @returns {{ priorities: Record<WorkCategory, number> }}
 */
export function deriveDefaultsFromSkills(skills) {
  const levels = skills?.levels ?? {};
  /** @type {Record<WorkCategory, number>} */
  const priorities = /** @type {any} */ ({});
  for (const cat of WORK_CATEGORIES) {
    const skillId = CATEGORY_TO_SKILL[cat];
    if (skillId == null) {
      priorities[cat] = DEFAULT_PRIORITY;
    } else {
      const lvl = levels[skillId]?.level ?? 0;
      priorities[cat] = lvl >= DEFAULT_SKILL_THRESHOLD ? DEFAULT_PRIORITY : 0;
    }
  }
  return { priorities };
}

/**
 * Does this cow's WorkPriorities component let them take a job of `kind`?
 * A kind may belong to multiple categories (install/uninstall); enabled in
 * ANY is sufficient. Unknown kinds are permitted (soft-fail so adding a new
 * job doesn't silently blackhole).
 *
 * @param {{ priorities?: Record<string, number> } | undefined} wp
 * @param {string} kind
 */
export function canCowDoJobKind(wp, kind) {
  const cats = KIND_TO_CATEGORIES[kind];
  if (!cats) return true;
  const priorities = wp?.priorities;
  if (!priorities) return true;
  for (const cat of cats) {
    if ((priorities[cat] | 0) > 0) return true;
  }
  return false;
}

/**
 * Effective priority for a job kind given this cow's WorkPriorities — the
 * lowest (= most urgent) priority across every enabled category that owns
 * the kind. Returns 0 if the cow can't do the job at all. Returns
 * `DEFAULT_PRIORITY` when the component is missing or the kind is unknown,
 * so untagged flows behave as before.
 *
 * No caller yet; reserved for a follow-up that teaches `findUnclaimed` to
 * sort candidates by player-set priority within a tier.
 *
 * @param {{ priorities?: Record<string, number> } | undefined} wp
 * @param {string} kind
 */
export function priorityForJobKind(wp, kind) {
  const cats = KIND_TO_CATEGORIES[kind];
  if (!cats) return DEFAULT_PRIORITY;
  const priorities = wp?.priorities;
  if (!priorities) return DEFAULT_PRIORITY;
  let best = 0;
  for (const cat of cats) {
    const p = priorities[cat] | 0;
    if (p > 0 && (best === 0 || p < best)) best = p;
  }
  return best;
}

/**
 * Sanitize a priorities blob from a save file or hand-authored test. Clamps
 * integers into [MIN_PRIORITY, MAX_PRIORITY]; missing categories default to 0.
 *
 * @param {unknown} raw
 */
export function sanitizePriorities(raw) {
  /** @type {Record<WorkCategory, number>} */
  const out = /** @type {any} */ ({});
  const obj = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  for (const cat of WORK_CATEGORIES) {
    const v = obj[cat];
    const n = typeof v === 'number' ? v | 0 : 0;
    out[cat] = Math.max(MIN_PRIORITY, Math.min(MAX_PRIORITY, n));
  }
  return out;
}
