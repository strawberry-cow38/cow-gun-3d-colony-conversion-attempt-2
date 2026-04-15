/**
 * Recipe + Bill registry for production buildings.
 *
 * Recipe: static "N of X + M of Y → K of Z, takes T ticks".
 * Bill: player-instantiated order on a building naming a recipe + target count.
 */

/**
 * @typedef {Object} Ingredient
 * @property {string} kind   item kind required (must exist in items.js)
 * @property {number} count  units consumed per craft
 *
 * @typedef {Object} Recipe
 * @property {string} id        stable key — "smelt_iron"
 * @property {string} label     UI display string
 * @property {Ingredient[]} ingredients
 * @property {string} outputKind
 * @property {number} outputCount
 * @property {number} workTicks how long the furnace runs to complete one craft
 *
 * @typedef {'forever' | 'count' | 'untilHave'} BillCountMode
 *
 * @typedef {Object} Bill
 * @property {number} id          unique within the host's Bills.nextBillId
 * @property {string} recipeId    references RECIPES[id]
 * @property {boolean} suspended  player-paused; the autonomous tick skips it
 * @property {BillCountMode} countMode
 * @property {number} target      meaning depends on countMode (count: how
 *                                many to make; untilHave: stockpile cap)
 * @property {number} done        crafts completed so far (for count mode)
 */

/** @type {Record<string, Recipe>} */
export const RECIPES = {};

/** @type {string[]} */
export const RECIPE_ORDER = [];
