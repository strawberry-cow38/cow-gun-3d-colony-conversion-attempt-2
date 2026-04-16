/**
 * Meal quality: the 7-tier scale that any cooked food carries, plus the
 * hooks eating code needs (nutrition multiplier, food-poisoning chance,
 * edibility). Quality also gates the cow's "pick the best food" selector.
 *
 * Tiers are ordered lowest → highest; `qualityRank` returns the index so
 * comparisons are "> other's rank".
 *
 * Raw food has no cooked quality; eating code treats raw food as the
 * `RAW_FOOD_RANK` for sorting purposes so ANY tasty+ meal wins over raw.
 */

import { skillFactorFor } from './skills.js';

/** @typedef {'inedible'|'unpleasant'|'decent'|'tasty'|'delicious'|'lavish'|'gourmet'} Quality */

/** @type {Quality[]} */
export const QUALITY_TIERS = [
  'inedible',
  'unpleasant',
  'decent',
  'tasty',
  'delicious',
  'lavish',
  'gourmet',
];

/**
 * Sort key cows use to prefer cooked food over raw — raw food falls
 * between 'unpleasant' and 'decent' so cows reach for even a decent meal
 * before a raw crop, but still eat raw if nothing else is around.
 */
export const RAW_FOOD_RANK = 1.5;

/** @type {Record<Quality, number>} Nutrition multiplier vs base FOOD_NUTRITION. */
const NUTRITION_MULT = {
  inedible: 0.2,
  unpleasant: 0.6,
  decent: 1.0,
  tasty: 1.3,
  delicious: 1.6,
  lavish: 2.0,
  gourmet: 2.5,
};

/** @type {Record<Quality, number>} Chance of food poisoning per bite (0..1). Zero at tasty+. */
const POISONING_CHANCE = {
  inedible: 0.5,
  unpleasant: 0.25,
  decent: 0.08,
  tasty: 0,
  delicious: 0,
  lavish: 0,
  gourmet: 0,
};

/** @type {Record<Quality, number>} UI tint per tier. Grey → tan → green → gold → purple → teal → rainbow-ish. */
const QUALITY_COLOR = {
  inedible: 0x6b6b6b,
  unpleasant: 0x8a7a4a,
  decent: 0xc89a4a,
  tasty: 0xe6b35a,
  delicious: 0xf0c66e,
  lavish: 0xf5dc82,
  gourmet: 0xffe89a,
};

/** @param {string} q */
export function isQuality(q) {
  return QUALITY_TIERS.includes(/** @type {Quality} */ (q));
}

/** @param {string} q @returns {number} */
export function qualityRank(q) {
  const i = QUALITY_TIERS.indexOf(/** @type {Quality} */ (q));
  return i < 0 ? -1 : i;
}

/** @param {string} q */
export function qualityLabel(q) {
  if (!isQuality(q)) return 'unknown';
  return q[0].toUpperCase() + q.slice(1);
}

/** @param {Quality} q */
export function nutritionMultiplier(q) {
  return NUTRITION_MULT[q] ?? 1;
}

/** @param {Quality} q */
export function poisoningChance(q) {
  return POISONING_CHANCE[q] ?? 0;
}

/** @param {Quality} q */
export function qualityColor(q) {
  return QUALITY_COLOR[q] ?? 0xc89a4a;
}

/**
 * Convert a 0..1 cooking skill into a meal quality. Noisy — a perfectly
 * average cook still produces occasional lavish meals and occasional
 * unpleasant ones. Skill biases the centre of the distribution.
 *
 * @param {number} skill 0..1
 * @param {() => number} rng [0,1) — inject for determinism in tests
 * @returns {Quality}
 */
export function rollQuality(skill, rng = Math.random) {
  const s = Math.max(0, Math.min(1, skill));
  const centre = s * (QUALITY_TIERS.length - 1);
  const noise = (rng() + rng() + rng()) / 3 - 0.5;
  const rank = Math.round(centre + noise * 2.5);
  const clamped = Math.max(0, Math.min(QUALITY_TIERS.length - 1, rank));
  return QUALITY_TIERS[clamped];
}

/**
 * Cooking skill for a cow, normalized 0..1 for `rollQuality`. Thin adapter
 * over `skillFactorFor` that tolerates cowId=0 (legacy unassigned-cook
 * callers) by falling through to level-0.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} cowId
 * @returns {number} 0..1
 */
export function cookingSkillFor(world, cowId) {
  return skillFactorFor(world, cowId, 'cooking');
}

/**
 * Canonical signature for an ingredient list so meals crafted from the
 * same recipe stack together. Sorted, joined with '|'. Empty list → ''.
 *
 * @param {string[]} ingredients
 */
export function ingredientsSig(ingredients) {
  if (!ingredients || ingredients.length === 0) return '';
  return [...ingredients].sort().join('|');
}
