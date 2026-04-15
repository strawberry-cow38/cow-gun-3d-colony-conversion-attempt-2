/**
 * Item kind registry. One place to look up stack size, nutrition value, and
 * render color per item kind. Systems import from here instead of hardcoding.
 */

import { tileToWorld } from './coords.js';

export const ITEM_KINDS = /** @type {const} */ ([
  'wood',
  'stone',
  'food',
  'metal_ore',
  'coal',
  'iron',
]);

/** @type {Record<string, number>} */
export const MAX_STACK = {
  wood: 50,
  stone: 30,
  food: 20,
  metal_ore: 30,
  coal: 30,
  iron: 30,
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
  food: {
    label: 'Food',
    description: 'Harvested crops. Cows eat one unit to restore hunger.',
  },
  metal_ore: {
    label: 'Metal Ore',
    description: 'Mined from metal nodes. No use yet.',
  },
  coal: {
    label: 'Coal',
    description: 'Mined from coal seams. Fuel for the furnace.',
  },
  iron: {
    label: 'Iron',
    description: 'Smelted from metal ore in a furnace.',
  },
};

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
  food: 0.5,
  metal_ore: 8,
  coal: 3,
  iron: 4,
};

/** Total mass a cow can haul in a single trip. */
export const COW_CARRY_KG = 60;

/** @param {string} kind */
export function weightOf(kind) {
  return WEIGHT_PER_UNIT[kind] ?? 1;
}

/** @param {{ items: { kind: string, count: number }[] }} inv */
export function inventoryWeight(inv) {
  let kg = 0;
  for (const s of inv.items) kg += weightOf(s.kind) * s.count;
  return kg;
}

/** @param {{ items: { kind: string, count: number }[] }} inv */
export function inventoryFreeKg(inv) {
  return Math.max(0, COW_CARRY_KG - inventoryWeight(inv));
}

/**
 * Max units of `kind` the inventory can still accept, given remaining
 * capacity. Always >= 0.
 *
 * @param {{ items: { kind: string, count: number }[] }} inv
 * @param {string} kind
 */
export function unitsThatFit(inv, kind) {
  const w = weightOf(kind);
  if (w <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(inventoryFreeKg(inv) / w));
}

/**
 * @param {{ items: { kind: string, count: number }[] }} inv
 * @param {string} kind
 * @param {number} count
 * @returns {number} units actually added (capped by remaining capacity)
 */
export function inventoryAdd(inv, kind, count) {
  if (count <= 0) return 0;
  // Single pass: find the existing same-kind stack AND tally total weight.
  let kg = 0;
  let existing = null;
  for (const s of inv.items) {
    kg += weightOf(s.kind) * s.count;
    if (s.kind === kind) existing = s;
  }
  const w = weightOf(kind);
  const fit = w > 0 ? Math.max(0, Math.floor((COW_CARRY_KG - kg) / w)) : count;
  const add = Math.min(fit, count);
  if (add <= 0) return 0;
  if (existing) existing.count += add;
  else inv.items.push({ kind, count: add });
  return add;
}

/** @type {Record<string, number>} RGB hex per kind, used by itemInstancer + cow carry viz. */
export const KIND_COLOR = {
  wood: 0x8a5a2b,
  stone: 0x9aa0a6,
  food: 0xd66a3a,
  metal_ore: 0xb0a48a,
  coal: 0x2a2a2e,
  iron: 0xc8cbd0,
};

/** @param {string} kind */
export function maxStack(kind) {
  return MAX_STACK[kind] ?? 1;
}

/**
 * Drop one unit of `kind` at (i, j), merging into an existing same-kind stack
 * with room if one is there, else spawning a fresh stack with count=1.
 *
 * `opts.forbidden` (default false) sets the forbidden flag on a freshly spawned
 * stack and gates merging — a forbidden drop won't merge into an unforbidden
 * stack and vice versa, so the supply path can leave items reserved on a
 * furnace work spot without them blending into a haul-bound pile.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {string} kind
 * @param {number} i
 * @param {number} j
 * @param {{ forbidden?: boolean }} [opts]
 */
export function addItemToTile(world, grid, kind, i, j, opts) {
  if (!grid.inBounds(i, j)) return;
  const forbidden = opts?.forbidden === true;
  const cap = maxStack(kind);
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    const a = components.TileAnchor;
    const it = components.Item;
    if (
      a.i === i &&
      a.j === j &&
      it.kind === kind &&
      it.count < cap &&
      it.forbidden === forbidden
    ) {
      it.count += 1;
      return;
    }
  }
  const w = tileToWorld(i, j, grid.W, grid.H);
  world.spawn({
    Item: { kind, count: 1, capacity: cap, forbidden },
    ItemViz: {},
    TileAnchor: { i, j },
    Position: { x: w.x, y: grid.getElevation(i, j), z: w.z },
  });
}

/**
 * Drop `count` units in one call. Tops up existing same-kind stacks first
 * (forbidden flag must match), then spawns new stacks until everything is
 * placed. Single query sweep instead of N calls to addItemToTile.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {string} kind
 * @param {number} count
 * @param {number} i @param {number} j
 * @param {{ forbidden?: boolean }} [opts]
 */
export function addItemsToTile(world, grid, kind, count, i, j, opts) {
  if (!grid.inBounds(i, j) || count <= 0) return;
  const forbidden = opts?.forbidden === true;
  const cap = maxStack(kind);
  let remaining = count;
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    if (remaining <= 0) break;
    const a = components.TileAnchor;
    const it = components.Item;
    if (
      a.i === i &&
      a.j === j &&
      it.kind === kind &&
      it.count < cap &&
      it.forbidden === forbidden
    ) {
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
      Item: { kind, count: c, capacity: cap, forbidden },
      ItemViz: {},
      TileAnchor: { i, j },
      Position: { x: w.x, y: grid.getElevation(i, j), z: w.z },
    });
    remaining -= c;
  }
}
