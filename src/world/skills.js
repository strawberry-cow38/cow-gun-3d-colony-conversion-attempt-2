/**
 * Colonist skills: per-cow levels that modify work speed, quality, and yield.
 * Seven skill ids at launch — five active (cooking, construction, mining,
 * crafting, plants) and two dormant (melee, shooting) that are wired for
 * storage and display but have nothing awarding them XP yet. Combat systems
 * will turn them on later without a data migration.
 *
 * Levels run 0..MAX_LEVEL. XP to next level grows linearly so early gains
 * are quick and mastery slows — the classic rimworld-ish curve, simplified.
 *
 * Starting skills are seeded per-cow from: the profession entry (biggest
 * bonus), the childhood entry (smaller bonus), age (broad tiny creep), and
 * gaussian-ish random noise. Profession/childhood entries opt in by
 * attaching an optional `skills: { id: bonus }` field — unknown entries
 * contribute nothing, so the pool can be enriched gradually.
 *
 * Out of scope for this pass: passions, skill decay, per-skill work
 * priorities. learnRateMultiplier is stored per cow but unused — future
 * gameplay hook for XP-rate variance.
 */

/** @typedef {'cooking'|'construction'|'mining'|'crafting'|'plants'|'melee'|'shooting'} SkillId */

/** @type {SkillId[]} */
export const SKILL_IDS = [
  'cooking',
  'construction',
  'mining',
  'crafting',
  'plants',
  'melee',
  'shooting',
];

/** Human-readable label for each skill. */
export const SKILL_LABELS = /** @type {Record<SkillId, string>} */ ({
  cooking: 'Cooking',
  construction: 'Construction',
  mining: 'Mining',
  crafting: 'Crafting',
  plants: 'Plants',
  melee: 'Melee',
  shooting: 'Shooting',
});

export const MAX_LEVEL = 20;

/** Baseline XP awarded per completed work unit. */
export const XP_PER_WORK = 100;

/**
 * XP required to reach `level + 1` from `level`. Linear growth: level 0→1
 * costs 1000, level 9→10 costs 5500, level 19→20 costs 10500. Keeps the
 * early game reactive and the late game a long grind.
 *
 * @param {number} level
 */
export function xpForNextLevel(level) {
  return 1000 + Math.max(0, level) * 500;
}

/**
 * Normalized 0..1 skill factor used by quality rolls and work-speed modifiers.
 * Level 0 → 0, MAX_LEVEL → 1, linear in between.
 *
 * @param {number} level
 */
export function skillFactor(level) {
  return Math.max(0, Math.min(1, level / MAX_LEVEL));
}

/**
 * Read the level for a skill, returning 0 if the cow has no Skills component
 * or no entry for this id. Safe to call on any entity.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} cowId
 * @param {SkillId} skillId
 */
export function skillLevelFor(world, cowId, skillId) {
  if (cowId <= 0) return 0;
  const skills = world.get(cowId, 'Skills');
  return skills?.levels?.[skillId]?.level ?? 0;
}

/**
 * Level-normalized skill factor (0..1) for a cow. Drop-in replacement for the
 * old flat `cookingSkillFor` stub.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} cowId
 * @param {SkillId} skillId
 */
export function skillFactorFor(world, cowId, skillId) {
  return skillFactor(skillLevelFor(world, cowId, skillId));
}

/**
 * Add XP to a cow's skill and promote through level thresholds. Safe to call
 * when the cow has no Skills component — the XP is silently dropped. Honors
 * `learnRateMultiplier` so future per-cow variance plugs in for free.
 *
 * Melee/shooting are live ids here so the learning system doesn't need to
 * change when combat ships; no system currently calls this for them.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} cowId
 * @param {SkillId} skillId
 * @param {number} amount raw xp before learnRateMultiplier
 * @returns {number} levels gained on this call (0..MAX_LEVEL)
 */
export function awardXp(world, cowId, skillId, amount) {
  if (cowId <= 0 || amount <= 0) return 0;
  const skills = world.get(cowId, 'Skills');
  if (!skills) return 0;
  const entry = skills.levels[skillId] ?? { level: 0, xp: 0 };
  if (entry.level >= MAX_LEVEL) return 0;
  const mult = skills.learnRateMultiplier ?? 1;
  let xp = entry.xp + amount * mult;
  let level = entry.level;
  let gained = 0;
  while (level < MAX_LEVEL) {
    const need = xpForNextLevel(level);
    if (xp < need) break;
    xp -= need;
    level += 1;
    gained += 1;
  }
  if (level >= MAX_LEVEL) xp = 0;
  entry.level = level;
  entry.xp = xp;
  skills.levels[skillId] = entry;
  return gained;
}

/**
 * Triangular ~ gaussian noise in [-1, 1]. Three uniform samples averaged,
 * same trick `rollQuality` uses — cheap and good enough for stat rolls.
 *
 * @param {() => number} rng
 */
function gaussianish(rng) {
  return (rng() + rng() + rng()) / 1.5 - 1;
}

/** @typedef {Partial<Record<SkillId, number>>} SkillBonus */

/**
 * Roll a fresh Skills payload for a colonist. Pure — returns the new
 * component data, doesn't mutate the world. Level per skill is:
 *
 *   age creep × 0.8 + profession × 1.0 + childhood × 0.5
 *   + gaussian(stdDev 1.3), clamped to [0, MAX_LEVEL]
 *
 * Unused skills (melee, shooting) roll the same way so combat-ready
 * colonists spawn naturally.
 *
 * The caller supplies the already-resolved `childhoodBonus` and
 * `professionBonus` — keeping the text → bonus lookup in backstories.js
 * means this module doesn't need to know about the backstory pool.
 *
 * @param {{
 *   ageYears?: number,
 *   childhoodBonus?: SkillBonus,
 *   professionBonus?: SkillBonus,
 *   rng?: () => number,
 *   learnRateMultiplier?: number,
 *   skillMultiplier?: number,
 * }} opts
 * @returns {{ levels: Record<SkillId, { level: number, xp: number }>, learnRateMultiplier: number }}
 */
export function rollStartingSkills(opts = {}) {
  const rng = opts.rng ?? Math.random;
  const age = Math.max(0, opts.ageYears ?? 30);
  const childhoodBonus = opts.childhoodBonus ?? {};
  const professionBonus = opts.professionBonus ?? {};
  const skillMultiplier = opts.skillMultiplier ?? 1;

  // Age creep: adults gain a small broad baseline so a 55-year-old veteran
  // isn't uniformly level 0. Caps at MAX_AGE_CREEP — we don't want raw age
  // to dominate the profession signal.
  const MAX_AGE_CREEP = 4;
  const ageCreep = Math.min(MAX_AGE_CREEP, Math.max(0, (age - 18) / 10));

  /** @type {Record<SkillId, { level: number, xp: number }>} */
  const levels = /** @type {any} */ ({});
  for (const id of SKILL_IDS) {
    const prof = professionBonus[id] ?? 0;
    const child = childhoodBonus[id] ?? 0;
    const noise = gaussianish(rng) * 1.3;
    const raw = (ageCreep * 0.8 + prof + child * 0.5 + noise) * skillMultiplier;
    const level = Math.max(0, Math.min(MAX_LEVEL, Math.round(raw)));
    levels[id] = { level, xp: 0 };
  }

  // Per-cow learn multiplier: slight variance now (unused), designed so
  // the mean is 1 and 99% fall in ~[0.7, 1.3]. When learning turns on, this
  // gives "natural talent" cows without new data plumbing.
  const learnRateMultiplier =
    opts.learnRateMultiplier ?? Math.max(0.5, Math.min(1.5, 1 + gaussianish(rng) * 0.15));

  return { levels, learnRateMultiplier };
}
