/**
 * Supply poster + bill dispatcher for stoves. Parallels easel.
 *
 * Meal quality is rolled once at craft start so the stack-identity tuple
 * (kind, forbidden, quality, ingredientsSig) is fixed before cooking
 * finishes — two meals with different ingredients or rolls never stack.
 */

import {
  buildHaulTargetedCounts,
  findNearestAvailableItem,
  totalAvailableByKind,
} from '../jobs/haul.js';
import { kindsWithTag, stackCount, stackRemove } from '../world/items.js';
import { cookingSkillFor, rollQuality } from '../world/quality.js';
import { RECIPES, STATION_RECIPES } from '../world/recipes.js';
import { computeStockByKind } from '../world/stock.js';

/**
 * Item kinds that can satisfy a recipe ingredient — either the single kind
 * it names, or every kind carrying its tag.
 *
 * @param {import('../world/recipes.js').Ingredient} ing
 */
function ingredientKinds(ing) {
  if (ing.kind) return [ing.kind];
  if (ing.tag) return kindsWithTag(ing.tag);
  return [];
}

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
      const availableByKind = totalAvailableByKind(world, claimed);
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
            let have = 0;
            for (const k of ingredientKinds(ing)) have += stackCount(stove.stored ?? [], k);
            if (have < ing.count) {
              allMet = false;
              break;
            }
          }
          if (allMet) {
            /** Actually-consumed food kinds, one entry per unit, so stack
             *  identity distinguishes e.g. `corn + carrot` from `potato + potato`. */
            const consumedFood = [];
            for (const ing of recipe.ingredients) {
              let need = ing.count;
              for (const k of ingredientKinds(ing)) {
                if (need <= 0) break;
                const take = Math.min(stackCount(stove.stored ?? [], k), need);
                if (take === 0) continue;
                stackRemove(stove.stored, k, take);
                if (ing.tag === 'rawFood') for (let n = 0; n < take; n++) consumedFood.push(k);
                need -= take;
              }
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
            stove.mealIngredients = consumedFood;
            board.post('cook', {
              stoveId,
              i: stove.workI,
              j: stove.workJ,
              lockedCowId: 0,
            });
            cookInFlight.add(stoveId);
            break;
          }

          /** @type {{ kinds: string[], need: number }[]} */
          const deficits = [];
          let feasible = true;
          for (const ing of recipe.ingredients) {
            const kinds = ingredientKinds(ing);
            let have = 0;
            let inFlight = 0;
            for (const k of kinds) {
              have += stackCount(stove.stored ?? [], k);
              inFlight += supplyInFlight.get(`${stoveId}:${k}`) ?? 0;
            }
            const need = ing.count - have - inFlight;
            if (need <= 0) continue;
            let avail = 0;
            for (const k of kinds) avail += availableByKind.get(k) ?? 0;
            if (avail < need) {
              feasible = false;
              break;
            }
            deficits.push({ kinds, need });
          }
          if (!feasible) break;

          for (const { kinds, need: initialNeed } of deficits) {
            let need = initialNeed;
            while (need > 0) {
              /** Find the nearest source across any kind that satisfies this
               *  ingredient — for tag ingredients this lets us pull corn from
               *  one pile and carrots from another in the same request loop. */
              let best = null;
              let bestD = Number.POSITIVE_INFINITY;
              /** @type {string | null} */
              let bestKind = null;
              for (const k of kinds) {
                const src = findNearestAvailableItem(
                  world,
                  grid,
                  claimed,
                  k,
                  stove.workI,
                  stove.workJ,
                );
                if (!src) continue;
                const d = Math.max(Math.abs(src.i - stove.workI), Math.abs(src.j - stove.workJ));
                if (d < bestD) {
                  best = src;
                  bestD = d;
                  bestKind = k;
                }
              }
              if (!best || !bestKind) break;
              const bundle = Math.min(need, best.avail);
              board.post('supply', {
                itemId: best.id,
                kind: bestKind,
                count: bundle,
                fromI: best.i,
                fromJ: best.j,
                toI: stove.workI,
                toJ: stove.workJ,
                stoveId,
                toSupply: true,
              });
              claimed.set(best.id, (claimed.get(best.id) ?? 0) + bundle);
              const key = `${stoveId}:${bestKind}`;
              supplyInFlight.set(key, (supplyInFlight.get(key) ?? 0) + bundle);
              availableByKind.set(bestKind, (availableByKind.get(bestKind) ?? 0) - bundle);
              need -= bundle;
            }
          }
          break;
        }
      }
    },
  };
}
