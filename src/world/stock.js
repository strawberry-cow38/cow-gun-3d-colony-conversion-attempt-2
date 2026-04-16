/**
 * Counts how many units of each item kind exist in the colony's reserves.
 * Shared between the furnace/easel systems (for `untilHave` ceiling checks)
 * and the bill UI (for showing current stock next to a bill's cap target).
 *
 * Always counted: loose/stockpile Items (non-forbidden), cow Inventories,
 * and every furnace's `outputs` (finished, waiting for a haul-out job).
 *
 * Optional: `includeActiveCrafts` adds `recipe.outputCount` for every
 * station (furnace or easel) with an active craft. The system wants that
 * (prevents greenlight of a redundant craft mid-cook); the UI wants it off
 * (master prefers the panel to show only what's physically in storage).
 */

import { RECIPES } from './recipes.js';

/**
 * @param {import('../ecs/world.js').World} world
 * @param {{ includeActiveCrafts?: boolean }} [opts]
 * @returns {Map<string, number>}
 */
export function computeStockByKind(world, opts) {
  const includeActive = opts?.includeActiveCrafts ?? false;
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    const it = components.Item;
    if (it.forbidden) continue;
    out.set(it.kind, (out.get(it.kind) ?? 0) + it.count);
  }
  for (const { components } of world.query(['Inventory'])) {
    for (const s of components.Inventory.items) {
      out.set(s.kind, (out.get(s.kind) ?? 0) + s.count);
    }
  }
  for (const { components } of world.query(['Furnace', 'Bills'])) {
    const f = components.Furnace;
    for (const s of f.outputs) {
      out.set(s.kind, (out.get(s.kind) ?? 0) + s.count);
    }
    if (includeActive && f.activeBillId > 0) {
      const bill = components.Bills.list.find((b) => b.id === f.activeBillId);
      const recipe = bill ? RECIPES[bill.recipeId] : null;
      if (recipe) {
        out.set(recipe.outputKind, (out.get(recipe.outputKind) ?? 0) + recipe.outputCount);
      }
    }
  }
  for (const { components } of world.query(['Easel', 'Bills'])) {
    const e = components.Easel;
    if (includeActive && e.activeBillId > 0) {
      const bill = components.Bills.list.find((b) => b.id === e.activeBillId);
      const recipe = bill ? RECIPES[bill.recipeId] : null;
      if (recipe) {
        out.set(recipe.outputKind, (out.get(recipe.outputKind) ?? 0) + recipe.outputCount);
      }
    }
  }
  for (const { components } of world.query(['Stove', 'Bills'])) {
    const s = components.Stove;
    if (includeActive && s.activeBillId > 0) {
      const bill = components.Bills.list.find((b) => b.id === s.activeBillId);
      const recipe = bill ? RECIPES[bill.recipeId] : null;
      if (recipe) {
        out.set(recipe.outputKind, (out.get(recipe.outputKind) ?? 0) + recipe.outputCount);
      }
    }
  }
  return out;
}
