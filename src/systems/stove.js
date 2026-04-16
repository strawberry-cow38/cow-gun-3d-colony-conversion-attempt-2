/**
 * Supply poster + bill dispatcher for stoves. Parallels easel.
 *
 * Meal quality is rolled once at craft start so the stack-identity tuple
 * (kind, forbidden, quality, ingredientsSig) is fixed before cooking
 * finishes — two meals with different ingredients or rolls never stack.
 */

import { buildHaulTargetedCounts, findNearestAvailableItem } from '../jobs/haul.js';
import { stackCount, stackRemove } from '../world/items.js';
import { cookingSkillFor, rollQuality } from '../world/quality.js';
import { RECIPES, STATION_RECIPES } from '../world/recipes.js';
import { computeStockByKind } from '../world/stock.js';

/**
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeStoveSystem(board, grid) {
  return {
    name: 'stove',
    tier: 'rare',
    run(world) {
      /** @type {Map<string, number>} */
      const supplyInFlight = new Map();
      /** @type {Set<number>} */
      const cookInFlight = new Set();
      for (const j of board.jobs) {
        if (j.completed) continue;
        if (j.kind === 'supply' && typeof j.payload.stoveId === 'number') {
          const k = `${j.payload.stoveId}:${j.payload.kind}`;
          supplyInFlight.set(k, (supplyInFlight.get(k) ?? 0) + (j.payload.count ?? 1));
        } else if (j.kind === 'cook' && typeof j.payload.stoveId === 'number') {
          cookInFlight.add(j.payload.stoveId);
        }
      }

      const stockByKind = computeStockByKind(world, { includeActiveCrafts: true });
      const claimed = buildHaulTargetedCounts(world, board);
      const allowed = new Set(STATION_RECIPES.stove ?? []);

      for (const { id: stoveId, components } of world.query(['Stove', 'Bills', 'TileAnchor'])) {
        const stove = components.Stove;
        const bills = components.Bills;

        if (stove.activeBillId > 0) {
          if (!cookInFlight.has(stoveId)) {
            board.post('cook', {
              stoveId,
              i: stove.workI,
              j: stove.workJ,
              lockedCowId: stove.cookCowId | 0,
            });
            cookInFlight.add(stoveId);
          }
          continue;
        }

        for (const bill of bills.list) {
          if (bill.suspended) continue;
          if (!allowed.has(bill.recipeId)) continue;
          const recipe = RECIPES[bill.recipeId];
          if (!recipe) continue;
          if (bill.countMode === 'count' && bill.done >= bill.target) continue;
          if (
            bill.countMode === 'untilHave' &&
            (stockByKind.get(recipe.outputKind) ?? 0) >= bill.target
          ) {
            continue;
          }

          let allMet = true;
          for (const ing of recipe.ingredients) {
            if (stackCount(stove.stored ?? [], ing.kind) < ing.count) {
              allMet = false;
              break;
            }
          }
          if (allMet) {
            for (const ing of recipe.ingredients) {
              stackRemove(stove.stored, ing.kind, ing.count);
            }
            stove.activeBillId = bill.id;
            stove.workTicksRemaining = recipe.workTicks;
            stove.cookCowId = 0;
            stove.startTick = 0;
            // Quality is rolled without a cook yet — the skill lookup uses
            // the stove's future cook (0 = no cow) so this falls back to the
            // default stub skill. Re-rolled on craft finish if the assigned
            // cow turns out to matter; today's stub is flat so it doesn't.
            const skill = cookingSkillFor(world, 0);
            stove.mealQuality = rollQuality(skill);
            stove.mealIngredients = recipe.ingredients.map((ing) => ing.kind);
            board.post('cook', {
              stoveId,
              i: stove.workI,
              j: stove.workJ,
              lockedCowId: 0,
            });
            cookInFlight.add(stoveId);
            break;
          }

          for (const ing of recipe.ingredients) {
            const have = stackCount(stove.stored ?? [], ing.kind);
            const key = `${stoveId}:${ing.kind}`;
            const inFlight = supplyInFlight.get(key) ?? 0;
            let need = ing.count - have - inFlight;
            while (need > 0) {
              const src = findNearestAvailableItem(
                world,
                grid,
                claimed,
                ing.kind,
                stove.workI,
                stove.workJ,
              );
              if (!src) break;
              const bundle = Math.min(need, src.avail);
              board.post('supply', {
                itemId: src.id,
                kind: ing.kind,
                count: bundle,
                fromI: src.i,
                fromJ: src.j,
                toI: stove.workI,
                toJ: stove.workJ,
                stoveId,
                toSupply: true,
              });
              claimed.set(src.id, (claimed.get(src.id) ?? 0) + bundle);
              supplyInFlight.set(key, (supplyInFlight.get(key) ?? 0) + bundle);
              need -= bundle;
            }
          }
          break;
        }
      }
    },
  };
}
