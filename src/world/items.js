/**
 * Item kind registry. One place to look up stack size, nutrition value, and
 * render color per item kind. Systems import from here instead of hardcoding.
 */

export const ITEM_KINDS = /** @type {const} */ (['wood', 'stone', 'food']);

/** @type {Record<string, number>} */
export const MAX_STACK = {
  wood: 50,
  stone: 30,
  food: 20,
};

/** Hunger restored per unit of food consumed (0..1 scale). */
export const FOOD_NUTRITION = 0.35;

/** Cow starts looking for food when hunger drops below this. */
export const HUNGER_EAT_THRESHOLD = 0.45;

/** @type {Record<string, number>} RGB hex per kind, used by itemInstancer + cow carry viz. */
export const KIND_COLOR = {
  wood: 0x8a5a2b,
  stone: 0x9aa0a6,
  food: 0xd66a3a,
};

/** @param {string} kind */
export function maxStack(kind) {
  return MAX_STACK[kind] ?? 1;
}
