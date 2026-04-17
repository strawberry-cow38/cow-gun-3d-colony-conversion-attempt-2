/**
 * Autonomous furnace tick + supply poster. Rare-tier (period 8). For each
 * furnace:
 *
 *   1. Drain any pending outputs into stockpile slots by posting
 *      `haul`-from-furnace jobs (payload.fromFurnaceId). Already-in-flight
 *      hauls are deduplicated against outstanding jobs.
 *   2. If a craft is in flight: decrement workTicksRemaining by the period.
 *      On reaching zero, push outputCount units into `furnace.outputs`,
 *      increment bill.done, clear the active craft. If the active bill was
 *      removed or suspended mid-craft, abort the craft (ingredients already
 *      consumed).
 *   3. If idle: walk the bills list in order. For the first eligible bill
 *      (not suspended, not capped by countMode), check whether all
 *      ingredients are in `furnace.stored`. If so → consume + start craft.
 *      If not → post `supply` jobs for the deficit (bundled: one job per
 *      source stack, carrying up to the cow's 60 kg cap, deduplicated by
 *      unit count against in-flight supplies for this furnace).
 *
 * Bills are sequential — once the first eligible bill is found, the loop
 * stops. Lower bills wait their turn (matches RimWorld semantics).
 *
 * Supply jobs deposit straight into `furnace.stored` (see cow.js dropping
 * state) rather than spawning a tile item, so the ingredients never sit on
 * the ground where the haul poster might yank them back.
 */

import { TIER_PERIODS } from '../ecs/schedule.js';
import {
  buildHaulTargetedCounts,
  computeStockpileSlots,
  findAndReserveSlot,
  findNearestAvailableItem,
  totalAvailableByKind,
} from '../jobs/haul.js';
import { stackAdd, stackCount, stackRemove } from '../world/items.js';
import { RECIPES } from '../world/recipes.js';
import { computeStockByKind } from '../world/stock.js';

/**
 * @typedef FurnaceSystemOpts
 * @property {() => void} [onCraftChange]  fired when any furnace's craft
 *   starts or finishes — main wires this to mark the furnace instancer dirty
 *   so the glow toggles in lockstep with `Furnace.activeBillId`.
 */

/**
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {FurnaceSystemOpts} [opts]
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeFurnaceSystem(board, grid, opts) {
  const onCraftChange = opts?.onCraftChange ?? (() => {});
  return {
    name: 'furnace',
    tier: 'rare',
    run(world) {
      const period = TIER_PERIODS.rare;

      /** Supply jobs already on the board, keyed `${furnaceId}:${kind}`. */
      /** @type {Map<string, number>} */
      const supplyInFlight = new Map();
      /** Haul-from-furnace jobs already on the board, keyed the same way. */
      /** @type {Map<string, number>} */
      const haulFromInFlight = new Map();
      for (const j of board.jobs) {
        if (j.completed) continue;
        if (j.kind === 'supply' && typeof j.payload.furnaceId === 'number') {
          const k = `${j.payload.furnaceId}:${j.payload.kind}`;
          supplyInFlight.set(k, (supplyInFlight.get(k) ?? 0) + (j.payload.count ?? 1));
        } else if (j.kind === 'haul' && typeof j.payload.fromFurnaceId === 'number') {
          const k = `${j.payload.fromFurnaceId}:${j.payload.kind}`;
          haulFromInFlight.set(k, (haulFromInFlight.get(k) ?? 0) + (j.payload.count ?? 1));
        }
      }

      // untilHave ceilings include in-flight crafts so the idle branch won't
      // greenlight a redundant craft while the colony is already on track
      // to hit the target. (See computeStockByKind for the full ruleset.)
      const stockByKind = computeStockByKind(world, { includeActiveCrafts: true });

      const claimed = buildHaulTargetedCounts(world, board);
      const slots = computeStockpileSlots(world, grid, board);
      const availableByKind = totalAvailableByKind(world, claimed);

      for (const { id: furnaceId, components } of world.query(['Furnace', 'Bills', 'TileAnchor'])) {
        const furnace = components.Furnace;
        const bills = components.Bills;

        // Pass A: drain outputs into stockpile via haul-from-furnace jobs.
        for (const out of furnace.outputs) {
          const key = `${furnaceId}:${out.kind}`;
          let need = out.count - (haulFromInFlight.get(key) ?? 0);
          while (need > 0) {
            const target = findAndReserveSlot(
              grid,
              slots,
              out.kind,
              furnace.workI,
              furnace.workJ,
              need,
            );
            if (!target) break;
            board.post('haul', {
              fromFurnaceId: furnaceId,
              kind: out.kind,
              count: target.count,
              fromI: furnace.workI,
              fromJ: furnace.workJ,
              toI: target.i,
              toJ: target.j,
            });
            haulFromInFlight.set(key, (haulFromInFlight.get(key) ?? 0) + target.count);
            need -= target.count;
          }
        }

        if (furnace.activeBillId > 0) {
          const bill = bills.list.find((b) => b.id === furnace.activeBillId);
          if (!bill || bill.suspended) {
            furnace.activeBillId = 0;
            furnace.workTicksRemaining = 0;
            onCraftChange();
            continue;
          }
          furnace.workTicksRemaining -= period;
          if (furnace.workTicksRemaining <= 0) {
            const recipe = RECIPES[bill.recipeId];
            if (recipe) {
              stackAdd(furnace.outputs, recipe.outputKind, recipe.outputCount);
              bill.done += 1;
            }
            furnace.activeBillId = 0;
            furnace.workTicksRemaining = 0;
            onCraftChange();
          }
          continue;
        }

        for (const bill of bills.list) {
          if (bill.suspended) continue;
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
            if (stackCount(furnace.stored, ing.kind) < ing.count) {
              allMet = false;
              break;
            }
          }
          if (allMet) {
            for (const ing of recipe.ingredients) {
              stackRemove(furnace.stored, ing.kind, ing.count);
            }
            furnace.activeBillId = bill.id;
            furnace.workTicksRemaining = recipe.workTicks;
            onCraftChange();
            break;
          }

          // Feasibility gate: only post supplies when every ingredient's
          // remaining deficit can be fully sourced from the map right now.
          // Otherwise a bill stalls mid-supply (2 coal sitting on the furnace
          // while no copper_ore has even been mined).
          /** @type {{ kind: string, need: number }[]} */
          const deficits = [];
          let feasible = true;
          for (const ing of recipe.ingredients) {
            const have = stackCount(furnace.stored, ing.kind);
            const key = `${furnaceId}:${ing.kind}`;
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
            const key = `${furnaceId}:${kind}`;
            while (need > 0) {
              const src = findNearestAvailableItem(
                world,
                grid,
                claimed,
                kind,
                furnace.workI,
                furnace.workJ,
              );
              if (!src) break;
              const bundle = Math.min(need, src.avail);
              board.post('supply', {
                itemId: src.id,
                kind,
                count: bundle,
                fromI: src.i,
                fromJ: src.j,
                toI: furnace.workI,
                toJ: furnace.workJ,
                furnaceId,
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
