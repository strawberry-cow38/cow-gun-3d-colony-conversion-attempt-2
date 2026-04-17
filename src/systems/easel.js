/**
 * Autonomous easel tick + supply poster. Rare-tier (period 8). For each
 * easel:
 *
 *   1. Supply: if an eligible bill needs ingredients not in `stored`, post
 *      `supply` jobs targeting the easel's work-spot. Identical to the
 *      furnace supply pattern — ingredients stash in `stored`, not on the
 *      ground.
 *   2. Start: when all ingredients are in `stored`, consume them, set
 *      `activeBillId` and `workTicksRemaining`, and post a `paint` job.
 *   3. Re-post: if `activeBillId > 0` but no paint job exists on the board
 *      for this easel, post one. Happens after a cow releases (drafted /
 *      hunger preempt) and the job got completed or reaped.
 *
 * Unlike the furnace, the easel has NO outputs buffer and NO auto-tick of
 * the craft timer. The craft is MANNED: a cow claims the paint job, walks
 * to the work-spot, and counts down `workTicksRemaining` in runPaintJob
 * (src/systems/cow.js). On completion the cow spawns the Painting entity
 * on the easel tile and clears `activeBillId` + `artistCowId`.
 *
 * Artist lock: when a cow first arrives at the easel, she sets
 * `easel.artistCowId = her id` AND `paintJob.payload.lockedCowId = her id`.
 * If she's pulled away, the paint job goes back to the board with its lock
 * intact, so only she can resume (preserves attribution).
 */

import {
  buildHaulTargetedCounts,
  findNearestAvailableItem,
  totalAvailableByKind,
} from '../jobs/haul.js';
import { stackCount, stackRemove } from '../world/items.js';
import { RECIPES, STATION_RECIPES } from '../world/recipes.js';
import { computeStockByKind } from '../world/stock.js';

/**
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeEaselSystem(board, grid) {
  return {
    name: 'easel',
    tier: 'rare',
    run(world) {
      /** Supply jobs already on the board, keyed `${easelId}:${kind}`. */
      /** @type {Map<string, number>} */
      const supplyInFlight = new Map();
      /** Paint jobs already on the board, keyed by easelId. */
      /** @type {Set<number>} */
      const paintInFlight = new Set();
      for (const j of board.jobs) {
        if (j.completed) continue;
        if (j.kind === 'supply' && typeof j.payload.easelId === 'number') {
          const k = `${j.payload.easelId}:${j.payload.kind}`;
          supplyInFlight.set(k, (supplyInFlight.get(k) ?? 0) + (j.payload.count ?? 1));
        } else if (j.kind === 'paint' && typeof j.payload.easelId === 'number') {
          paintInFlight.add(j.payload.easelId);
        }
      }

      const stockByKind = computeStockByKind(world, { includeActiveCrafts: true });
      const claimed = buildHaulTargetedCounts(world, board);
      const availableByKind = totalAvailableByKind(world, claimed);
      const allowed = new Set(STATION_RECIPES.easel ?? []);

      for (const { id: easelId, components } of world.query(['Easel', 'Bills', 'TileAnchor'])) {
        const easel = components.Easel;
        const bills = components.Bills;

        // Active craft: ensure a paint job exists on the board.
        if (easel.activeBillId > 0) {
          if (!paintInFlight.has(easelId)) {
            board.post('paint', {
              easelId,
              i: easel.workI,
              j: easel.workJ,
              lockedCowId: easel.artistCowId | 0,
            });
            paintInFlight.add(easelId);
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
            if (stackCount(easel.stored ?? [], ing.kind) < ing.count) {
              allMet = false;
              break;
            }
          }
          if (allMet) {
            // Consume ingredients + start craft. The cow's paint job drives
            // the timer countdown; we just set the initial workTicksRemaining
            // here so the painting's final time tracks recipe cost.
            for (const ing of recipe.ingredients) {
              stackRemove(easel.stored, ing.kind, ing.count);
            }
            easel.activeBillId = bill.id;
            easel.workTicksRemaining = recipe.workTicks;
            easel.artistCowId = 0;
            easel.startTick = 0;
            board.post('paint', {
              easelId,
              i: easel.workI,
              j: easel.workJ,
              lockedCowId: 0,
            });
            paintInFlight.add(easelId);
            break;
          }

          // Feasibility gate — see furnace.js. Only post supplies when every
          // ingredient's deficit can be fully sourced right now.
          /** @type {{ kind: string, need: number }[]} */
          const deficits = [];
          let feasible = true;
          for (const ing of recipe.ingredients) {
            const have = stackCount(easel.stored ?? [], ing.kind);
            const key = `${easelId}:${ing.kind}`;
            const inFlight = supplyInFlight.get(key) ?? 0;
            const need = ing.count - have - inFlight;
            if (need <= 0) continue;
            if ((availableByKind.get(ing.kind) ?? 0) < need) {
              feasible = false;
              break;
            }
            deficits.push({ kind: ing.kind, need });
          }
          if (!feasible) break;

          for (const { kind, need: initialNeed } of deficits) {
            let need = initialNeed;
            const key = `${easelId}:${kind}`;
            while (need > 0) {
              const src = findNearestAvailableItem(
                world,
                grid,
                claimed,
                kind,
                easel.workI,
                easel.workJ,
              );
              if (!src) break;
              const bundle = Math.min(need, src.avail);
              board.post('supply', {
                itemId: src.id,
                kind,
                count: bundle,
                fromI: src.i,
                fromJ: src.j,
                toI: easel.workI,
                toJ: easel.workJ,
                easelId,
                toSupply: true,
              });
              claimed.set(src.id, (claimed.get(src.id) ?? 0) + bundle);
              supplyInFlight.set(key, (supplyInFlight.get(key) ?? 0) + bundle);
              availableByKind.set(kind, (availableByKind.get(kind) ?? 0) - bundle);
              need -= bundle;
            }
          }
          break;
        }
      }
    },
  };
}
