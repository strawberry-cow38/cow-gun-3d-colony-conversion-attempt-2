/**
 * Per-tick expel: for every furnace, spill any `stored` stacks whose kind
 * isn't needed by an active (non-suspended) bill's recipe. Spills onto the
 * furnace's workspot tile so the haul poster picks them up as normal items.
 *
 * Split out from the main furnace system (rare tier) so stray cargo — e.g.
 * stone supplied from a since-removed bill — clears the same tick it lands,
 * preventing the "furnace full of wrong ingredients, colony wedged" state
 * observed pre-fix.
 */

import { addItemsToTile } from '../world/items.js';
import { RECIPES } from '../world/recipes.js';

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeFurnaceExpelSystem(grid) {
  // Reused across furnaces within a tick — cleared per iteration.
  const needed = new Set();
  return {
    name: 'furnaceExpel',
    tier: 'every',
    run(world) {
      for (const { components } of world.query(['Furnace', 'Bills'])) {
        const furnace = components.Furnace;
        if (furnace.stored.length === 0) continue;
        needed.clear();
        for (const bill of components.Bills.list) {
          if (bill.suspended) continue;
          const recipe = RECIPES[bill.recipeId];
          if (!recipe) continue;
          for (const ing of recipe.ingredients) needed.add(ing.kind);
        }
        for (let i = furnace.stored.length - 1; i >= 0; i--) {
          const stack = furnace.stored[i];
          if (!needed.has(stack.kind)) {
            addItemsToTile(world, grid, stack.kind, stack.count, furnace.workI, furnace.workJ);
            furnace.stored.splice(i, 1);
          }
        }
      }
    },
  };
}
