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
export const RECIPES = {
  smelt_iron: {
    id: 'smelt_iron',
    label: 'Smelt iron',
    ingredients: [
      { kind: 'coal', count: 1 },
      { kind: 'metal_ore', count: 5 },
    ],
    outputKind: 'iron',
    outputCount: 5,
    workTicks: 600,
  },
};

/** @type {string[]} */
export const RECIPE_ORDER = ['smelt_iron'];

/** @type {BillCountMode[]} */
export const BILL_COUNT_MODES = ['forever', 'count', 'untilHave'];

/** @param {BillCountMode} mode */
export function nextCountMode(mode) {
  const i = BILL_COUNT_MODES.indexOf(mode);
  return BILL_COUNT_MODES[(i + 1) % BILL_COUNT_MODES.length];
}

/**
 * Short, one-line status string summarizing a bill's progress in its current
 * count mode. UI shows this next to the recipe label.
 *
 * @param {import('./recipes.js').Bill} bill
 */
export function billProgressLabel(bill) {
  if (bill.countMode === 'forever') return '∞';
  if (bill.countMode === 'count') return `${bill.done} / ${bill.target}`;
  return `stock ≤ ${bill.target}`;
}
