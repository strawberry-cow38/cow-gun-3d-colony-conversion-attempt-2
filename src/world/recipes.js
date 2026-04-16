/**
 * Recipe + Bill registry for production buildings.
 *
 * Recipe: static "N of X + M of Y → K of Z, takes T ticks".
 * Bill: player-instantiated order on a building naming a recipe + target count.
 */

/**
 * @typedef {Object} Ingredient
 * @property {string} kind    item kind required (must exist in items.js). Set
 *                            to '' when the ingredient is tag-keyed instead.
 * @property {string} [tag]   optional — when set, any kind carrying this tag
 *                            satisfies the ingredient. Overrides `kind`.
 * @property {number} count   units consumed per craft
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
  paint_small: {
    id: 'paint_small',
    label: 'Paint small painting',
    ingredients: [{ kind: 'wood', count: 2 }],
    outputKind: 'painting',
    outputCount: 1,
    workTicks: 400,
  },
  paint_medium: {
    id: 'paint_medium',
    label: 'Paint medium painting',
    ingredients: [{ kind: 'wood', count: 4 }],
    outputKind: 'painting',
    outputCount: 1,
    workTicks: 800,
  },
  paint_large: {
    id: 'paint_large',
    label: 'Paint large painting',
    ingredients: [{ kind: 'wood', count: 6 }],
    outputKind: 'painting',
    outputCount: 1,
    workTicks: 1400,
  },
  paint_huge: {
    id: 'paint_huge',
    label: 'Paint HUGE painting',
    ingredients: [{ kind: 'wood', count: 10 }],
    outputKind: 'painting',
    outputCount: 1,
    workTicks: 2400,
  },
  cook_simple_meal: {
    id: 'cook_simple_meal',
    label: 'Cook simple meal',
    ingredients: [
      { kind: 'wood', count: 1 },
      { kind: '', tag: 'rawFood', count: 2 },
    ],
    outputKind: 'meal',
    outputCount: 1,
    workTicks: 300,
  },
};

/**
 * Recipes valid on a given station kind. Also the display order used by the
 * bill-editor popup. Read by the station system's eligibility check.
 *
 * @type {Record<string, string[]>}
 */
export const STATION_RECIPES = {
  furnace: ['smelt_iron'],
  easel: ['paint_small', 'paint_medium', 'paint_large', 'paint_huge'],
  stove: ['cook_simple_meal'],
};

/** Size in tiles (wall-mount span) per painting recipe. */
/** @type {Record<string, number>} */
export const PAINTING_SIZE_BY_RECIPE = {
  paint_small: 1,
  paint_medium: 2,
  paint_large: 3,
  paint_huge: 4,
};

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
 * `count` mode appends a preview of total units yielded (target × outputCount)
 * when a recipe is provided — "5/10 → 50". `untilHave` shows current stock
 * against the target cap when that number is passed in.
 *
 * @param {import('./recipes.js').Bill} bill
 * @param {{ recipe?: Recipe, stockOfOutput?: number }} [ctx]
 */
export function billProgressLabel(bill, ctx) {
  if (bill.countMode === 'forever') return '∞';
  if (bill.countMode === 'count') {
    const base = `${bill.done} / ${bill.target}`;
    const recipe = ctx?.recipe;
    if (!recipe) return base;
    return `${base} → ${bill.target * recipe.outputCount}`;
  }
  const stock = ctx?.stockOfOutput;
  if (typeof stock === 'number') return `${stock} / ${bill.target}`;
  return `stock ≤ ${bill.target}`;
}
