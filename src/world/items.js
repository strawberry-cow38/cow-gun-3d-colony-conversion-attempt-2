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
 * @param {import('../ecs/world.js').World} world
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {string} kind
 * @param {number} i
 * @param {number} j
 */
export function addItemToTile(world, grid, kind, i, j) {
  if (!grid.inBounds(i, j)) return;
  const cap = maxStack(kind);
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    const a = components.TileAnchor;
    const it = components.Item;
    if (a.i === i && a.j === j && it.kind === kind && it.count < cap) {
      it.count += 1;
      return;
    }
  }
  const w = tileToWorld(i, j, grid.W, grid.H);
  world.spawn({
    Item: { kind, count: 1, capacity: cap, forbidden: false },
    ItemViz: {},
    TileAnchor: { i, j },
    Position: { x: w.x, y: grid.getElevation(i, j), z: w.z },
  });
}
