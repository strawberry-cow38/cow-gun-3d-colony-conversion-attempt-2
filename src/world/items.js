/**
 * Item kind registry. One place to look up stack size, nutrition value, and
 * render color per item kind. Systems import from here instead of hardcoding.
 */

import { tileToWorld } from './coords.js';
import { ingredientsSig } from './quality.js';

export const ITEM_KINDS = /** @type {const} */ ([
  'wood',
  'stone',
  'corn',
  'carrot',
  'potato',
  'copper_ore',
  'coal',
  'copper',
  'painting',
  'meal',
]);

/** @type {Record<string, number>} */
export const MAX_STACK = {
  wood: 50,
  stone: 30,
  corn: 20,
  carrot: 20,
  potato: 20,
  copper_ore: 30,
  coal: 30,
  copper: 30,
  painting: 1,
  meal: 10,
};

/** @type {Record<string, { label: string, description: string }>} */
export const ITEM_INFO = {
  wood: {
    label: 'Wood',
    description: 'Chopped from trees. Builds walls, doors, roofs, and floors.',
  },
  stone: {
    label: 'Stone',
    description: 'Heavy raw material for sturdier builds.',
  },
  corn: {
    label: 'Corn',
    description: 'Raw food. Cows eat one unit to restore hunger; cooks into meals.',
  },
  carrot: {
    label: 'Carrot',
    description: 'Raw food. Cows eat one unit to restore hunger; cooks into meals.',
  },
  potato: {
    label: 'Potato',
    description: 'Raw food. Cows eat one unit to restore hunger; cooks into meals.',
  },
  copper_ore: {
    label: 'Copper Ore',
    description: 'Mined from copper nodes. No use yet.',
  },
  coal: {
    label: 'Coal',
    description: 'Mined from coal seams. Fuel for the furnace.',
  },
  copper: {
    label: 'Copper',
    description: 'Smelted from copper ore in a furnace.',
  },
  painting: {
    label: 'Painting',
    description: 'Unique artwork made by a cow at an easel. Non-stackable.',
  },
  meal: {
    label: 'Meal',
    description:
      'A cooked dish. Quality depends on the cook; higher tiers feed more and never poison.',
  },
};

/**
 * Item tags — an item kind can carry zero or more tags. Recipes can request
 * ingredients by tag (e.g. `{ tag: 'rawFood', count: 2 }`) and the stove
 * will pull from any matching kind in its supply. `mealIngredients` records
 * the actually-consumed kinds so two meals made from different crops form
 * distinct stacks and the panel can show "Corn + Carrot" vs "Potato + Potato".
 *
 * @type {Record<string, string[]>}
 */
export const ITEM_TAGS = {
  wood: [],
  stone: [],
  corn: ['rawFood'],
  carrot: ['rawFood'],
  potato: ['rawFood'],
  copper_ore: [],
  coal: [],
  copper: [],
  painting: [],
  meal: [],
};

/** @param {string} kind @param {string} tag */
export function itemHasTag(kind, tag) {
  return (ITEM_TAGS[kind] ?? []).includes(tag);
}

/**
 * Item categories — drives the stockpile zone filter UI (collapsible tree of
 * categories, each with a toggle + per-kind checkboxes). Every kind belongs
 * to exactly one category. `Junk` is reserved for future tagging; new zones
 * start with every category allowed except Junk, so unclassified-as-junk
 * items keep getting stockpiled until the player explicitly opts in.
 *
 * @type {{ id: string, label: string, kinds: string[] }[]}
 */
export const ITEM_CATEGORIES = [
  { id: 'materials', label: 'Materials', kinds: ['wood', 'stone', 'coal'] },
  { id: 'metals', label: 'Metals', kinds: ['copper_ore', 'copper'] },
  { id: 'food', label: 'Food', kinds: ['corn', 'carrot', 'potato', 'meal'] },
  { id: 'art', label: 'Art', kinds: ['painting'] },
  { id: 'junk', label: 'Junk', kinds: [] },
];

/** @type {Map<string, string>} kind → category id */
const KIND_TO_CATEGORY = (() => {
  const m = new Map();
  for (const c of ITEM_CATEGORIES) for (const k of c.kinds) m.set(k, c.id);
  return m;
})();

/** @param {string} kind */
export function categoryOfKind(kind) {
  return KIND_TO_CATEGORY.get(kind) ?? 'junk';
}

/** Kinds allowed by default on a new stockpile zone — every category except Junk. */
export function defaultAllowedKinds() {
  const out = new Set();
  for (const c of ITEM_CATEGORIES) {
    if (c.id === 'junk') continue;
    for (const k of c.kinds) out.add(k);
  }
  return out;
}

/**
 * All item kinds that carry `tag`, in ITEM_KINDS declaration order so the
 * stove's supply loop is deterministic.
 *
 * @param {string} tag
 * @returns {string[]}
 */
export function kindsWithTag(tag) {
  const out = [];
  for (const k of ITEM_KINDS) {
    if ((ITEM_TAGS[k] ?? []).includes(tag)) out.push(k);
  }
  return out;
}

/** Hunger restored per unit of food consumed (0..1 scale). */
export const FOOD_NUTRITION = 0.35;

/** Cow starts looking for food when hunger drops below this. */
export const HUNGER_EAT_THRESHOLD = 0.45;

/**
 * Realistic per-unit mass in kilograms. Drives carry capacity for cow
 * inventory (a 60kg cow can haul ~12 wood logs or ~7 ore lumps in a single
 * trip). Tune for game feel rather than physics — meat/food intentionally
 * light so cows can carry a meal worth of food without filling their pack.
 *
 * @type {Record<string, number>}
 */
export const WEIGHT_PER_UNIT = {
  wood: 5,
  stone: 6,
  corn: 0.5,
  carrot: 0.5,
  potato: 0.5,
  copper_ore: 8,
  coal: 3,
  copper: 4,
  painting: 4,
  meal: 0.4,
};

/** Total mass a cow can haul in a single trip. */
export const COW_CARRY_KG = 60;

/** @param {string} kind */
export function weightOf(kind) {
  return WEIGHT_PER_UNIT[kind] ?? 1;
}

/** @param {{ items: { kind: string, count: number, quality?: string, ingredients?: string[], cookedBy?: number }[] }} inv */
export function inventoryWeight(inv) {
  let kg = 0;
  for (const s of inv.items) kg += weightOf(s.kind) * s.count;
  return kg;
}

/** @param {{ items: { kind: string, count: number, quality?: string, ingredients?: string[], cookedBy?: number }[] }} inv */
export function inventoryFreeKg(inv) {
  return Math.max(0, COW_CARRY_KG - inventoryWeight(inv));
}

/**
 * Max units of `kind` the inventory can still accept, given remaining
 * capacity. Always >= 0.
 *
 * @param {{ items: { kind: string, count: number, quality?: string, ingredients?: string[], cookedBy?: number }[] }} inv
 * @param {string} kind
 */
export function unitsThatFit(inv, kind) {
  const w = weightOf(kind);
  if (w <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(inventoryFreeKg(inv) / w));
}

/**
 * @param {{ items: { kind: string, count: number, quality?: string, ingredients?: string[], cookedBy?: number }[] }} inv
 * @param {string} kind
 * @param {number} count
 * @param {{ quality?: string, ingredients?: string[], cookedBy?: number }} [opts]
 * @returns {number} units actually added (capped by remaining capacity)
 */
export function inventoryAdd(inv, kind, count, opts) {
  if (count <= 0) return 0;
  const quality = opts?.quality ?? '';
  const ingredients = opts?.ingredients ?? [];
  const cookedBy = opts?.cookedBy ?? 0;
  const probe = { kind, forbidden: false, quality, ingredients, cookedBy };
  // Single pass: find a matching stack AND tally total weight.
  let kg = 0;
  let existing = null;
  for (const s of inv.items) {
    kg += weightOf(s.kind) * s.count;
    if (
      !existing &&
      stackKeyMatches(
        {
          ...s,
          forbidden: false,
          quality: s.quality ?? '',
          ingredients: s.ingredients ?? [],
          cookedBy: s.cookedBy ?? 0,
        },
        probe,
      )
    ) {
      existing = s;
    }
  }
  const w = weightOf(kind);
  const fit = w > 0 ? Math.max(0, Math.floor((COW_CARRY_KG - kg) / w)) : count;
  const add = Math.min(fit, count);
  if (add <= 0) return 0;
  if (existing) existing.count += add;
  else inv.items.push({ kind, count: add, quality, ingredients: ingredients.slice(), cookedBy });
  return add;
}

/**
 * Unweighted `{kind,count}[]` stack-array helpers — shared by Furnace.stored
 * and Furnace.outputs. Cow Inventory uses the weight-budgeted variant above.
 *
 * @param {{ kind: string, count: number }[]} arr
 * @param {string} kind
 * @returns {number}
 */
export function stackCount(arr, kind) {
  for (const s of arr) if (s.kind === kind) return s.count;
  return 0;
}

/**
 * @param {{ kind: string, count: number }[]} arr
 * @param {string} kind
 * @param {number} count
 */
export function stackAdd(arr, kind, count) {
  if (count <= 0) return;
  for (const s of arr) {
    if (s.kind === kind) {
      s.count += count;
      return;
    }
  }
  arr.push({ kind, count });
}

/**
 * Remove up to `count` units of `kind`. Prunes emptied entries. Returns
 * units actually removed.
 *
 * @param {{ kind: string, count: number }[]} arr
 * @param {string} kind
 * @param {number} count
 * @returns {number}
 */
export function stackRemove(arr, kind, count) {
  if (count <= 0) return 0;
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];
    if (s.kind !== kind) continue;
    const take = Math.min(s.count, count);
    s.count -= take;
    if (s.count <= 0) arr.splice(i, 1);
    return take;
  }
  return 0;
}

/** @type {Record<string, number>} RGB hex per kind, used by itemInstancer + cow carry viz. */
export const KIND_COLOR = {
  wood: 0x8a5a2b,
  stone: 0x9aa0a6,
  corn: 0xd9c24a,
  carrot: 0xe07b2a,
  potato: 0x8a5a2a,
  copper_ore: 0x8a4a26,
  coal: 0x2a2a2e,
  copper: 0xb87333,
  painting: 0xd8b26a,
  meal: 0xd8a860,
};

/** @param {string} kind */
export function maxStack(kind) {
  return MAX_STACK[kind] ?? 1;
}

/**
 * Composite stack key — two items with the same key are mergeable. Encodes
 * kind + forbidden + quality + cookedBy + ingredientsSig so yucky + gourmet
 * meals never pollute each other's stacks and different cooks' work stays
 * separate.
 *
 * @param {{ kind: string, forbidden?: boolean, quality?: string, ingredients?: string[], cookedBy?: number }} it
 * @returns {string}
 */
export function stackKey(it) {
  const forbidden = it.forbidden === true ? '1' : '0';
  const quality = it.quality ?? '';
  const cookedBy = it.cookedBy ?? 0;
  const sig = ingredientsSig(it.ingredients ?? []);
  return `${it.kind}|${forbidden}|${quality}|${cookedBy}|${sig}`;
}

/**
 * @param {{ kind: string, forbidden: boolean, quality?: string, ingredients?: string[], cookedBy?: number }} a
 * @param {{ kind: string, forbidden: boolean, quality?: string, ingredients?: string[], cookedBy?: number }} b
 */
function stackKeyMatches(a, b) {
  return stackKey(a) === stackKey(b);
}

/**
 * Drop one unit of `kind` at (i, j), merging into an existing matching stack
 * with room if one is there, else spawning a fresh stack with count=1.
 *
 * `opts.forbidden` (default false) sets the forbidden flag on a freshly spawned
 * stack and gates merging — a forbidden drop won't merge into an unforbidden
 * stack and vice versa, so the supply path can leave items reserved on a
 * furnace work spot without them blending into a haul-bound pile.
 *
 * `opts.quality` and `opts.ingredients` apply to cooked meals — two meals only
 * merge when BOTH match, so a tasty stack never contracts food poisoning from
 * an unpleasant drop landing on top.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {string} kind
 * @param {number} i
 * @param {number} j
 * @param {{ forbidden?: boolean, quality?: string, ingredients?: string[], cookedBy?: number }} [opts]
 */
export function addItemToTile(world, grid, kind, i, j, opts) {
  if (!grid.inBounds(i, j)) return;
  const forbidden = opts?.forbidden === true;
  const quality = opts?.quality ?? '';
  const ingredients = opts?.ingredients ?? [];
  const cookedBy = opts?.cookedBy ?? 0;
  const cap = maxStack(kind);
  const probe = { kind, forbidden, quality, ingredients, cookedBy };
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    const a = components.TileAnchor;
    const it = components.Item;
    if (a.i === i && a.j === j && it.count < cap && stackKeyMatches(it, probe)) {
      it.count += 1;
      return;
    }
  }
  const w = tileToWorld(i, j, grid.W, grid.H);
  world.spawn({
    Item: {
      kind,
      count: 1,
      capacity: cap,
      forbidden,
      quality,
      ingredients: ingredients.slice(),
      cookedBy,
    },
    ItemViz: {},
    TileAnchor: { i, j },
    Position: { x: w.x, y: grid.getElevation(i, j), z: w.z },
  });
}

/**
 * Drop `count` units in one call. Tops up matching stacks first (forbidden +
 * quality + ingredients must all match), then spawns new stacks until
 * everything is placed. Single query sweep instead of N calls to addItemToTile.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {string} kind
 * @param {number} count
 * @param {number} i @param {number} j
 * @param {{ forbidden?: boolean, quality?: string, ingredients?: string[], cookedBy?: number, preferredZoneId?: number }} [opts]
 */
export function addItemsToTile(world, grid, kind, count, i, j, opts) {
  if (!grid.inBounds(i, j) || count <= 0) return;
  const forbidden = opts?.forbidden === true;
  const quality = opts?.quality ?? '';
  const ingredients = opts?.ingredients ?? [];
  const cookedBy = opts?.cookedBy ?? 0;
  const preferredZoneId = opts?.preferredZoneId ?? 0;
  const cap = maxStack(kind);
  const probe = { kind, forbidden, quality, ingredients, cookedBy };
  let remaining = count;
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    if (remaining <= 0) break;
    const a = components.TileAnchor;
    const it = components.Item;
    if (a.i === i && a.j === j && it.count < cap && stackKeyMatches(it, probe)) {
      const room = cap - it.count;
      const add = Math.min(room, remaining);
      it.count += add;
      remaining -= add;
    }
  }
  while (remaining > 0) {
    const c = Math.min(remaining, cap);
    const w = tileToWorld(i, j, grid.W, grid.H);
    world.spawn({
      Item: {
        kind,
        count: c,
        capacity: cap,
        forbidden,
        quality,
        ingredients: ingredients.slice(),
        cookedBy,
        preferredZoneId,
      },
      ItemViz: {},
      TileAnchor: { i, j },
      Position: { x: w.x, y: grid.getElevation(i, j), z: w.z },
    });
    remaining -= c;
  }
}
