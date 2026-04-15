/**
 * Autonomous furnace tick + supply poster. Rare-tier (period 8). For each
 * furnace:
 *
 *   1. If a craft is in flight: decrement workTicksRemaining by the period.
 *      On reaching zero, spawn outputCount items at the work spot, increment
 *      bill.done, clear the active craft. If the active bill was removed or
 *      suspended mid-craft, abort the craft (ingredients already consumed).
 *
 *   2. If idle: walk the bills list in order. For the first eligible bill
 *      (not suspended, not capped by countMode), check whether all
 *      ingredients are at the work spot. If so → consume + start craft. If
 *      not → post `supply` jobs for the deficit (up to one per missing unit,
 *      deduplicated against in-flight supplies for this furnace).
 *
 * Bills are sequential — once the first eligible bill is found, the loop
 * stops. Lower bills wait their turn (matches RimWorld semantics).
 *
 * Supply jobs land their drop as `forbidden: true` so the haul poster
 * doesn't immediately yank the ingredient back to the stockpile before the
 * next furnace tick consumes it.
 */

import { TIER_PERIODS } from '../ecs/schedule.js';
import { buildHaulTargetedCounts, findNearestAvailableItem } from '../jobs/haul.js';
import { addItemToTile } from '../world/items.js';
import { RECIPES } from '../world/recipes.js';

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
      for (const j of board.jobs) {
        if (j.completed || j.kind !== 'supply') continue;
        const k = `${j.payload.furnaceId}:${j.payload.kind}`;
        supplyInFlight.set(k, (supplyInFlight.get(k) ?? 0) + 1);
      }

      // Single item sweep: bucket counts by tile (for work-spot lookup) AND
      // by kind (for untilHave). Beats N full Item queries per furnace.
      // Tile bucket includes forbidden stacks since the furnace consumes them
      // regardless; kind bucket excludes forbidden so reserved supplies don't
      // count toward "have".
      /** @type {Map<number, Map<string, number>>} */
      const byTile = new Map();
      /** @type {Map<string, number>} */
      const stockByKind = new Map();
      for (const { components } of world.query(['Item', 'TileAnchor'])) {
        const it = components.Item;
        const a = components.TileAnchor;
        const idx = a.j * grid.W + a.i;
        let bucket = byTile.get(idx);
        if (!bucket) {
          bucket = new Map();
          byTile.set(idx, bucket);
        }
        bucket.set(it.kind, (bucket.get(it.kind) ?? 0) + it.count);
        if (!it.forbidden) {
          stockByKind.set(it.kind, (stockByKind.get(it.kind) ?? 0) + it.count);
        }
      }

      const claimed = buildHaulTargetedCounts(world, board);

      for (const { id: furnaceId, components } of world.query(['Furnace', 'Bills', 'TileAnchor'])) {
        const furnace = components.Furnace;
        const bills = components.Bills;

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
              for (let n = 0; n < recipe.outputCount; n++) {
                addItemToTile(world, grid, recipe.outputKind, furnace.workI, furnace.workJ);
              }
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

          const spotIdx = furnace.workJ * grid.W + furnace.workI;
          const onSpot = byTile.get(spotIdx);
          let allMet = true;
          for (const ing of recipe.ingredients) {
            if ((onSpot?.get(ing.kind) ?? 0) < ing.count) {
              allMet = false;
              break;
            }
          }
          if (allMet) {
            for (const ing of recipe.ingredients) {
              const consumed = consumeFromTile(
                world,
                furnace.workI,
                furnace.workJ,
                ing.kind,
                ing.count,
              );
              // Mirror the consumption into the in-memory buckets so a later
              // furnace this same tick sees the depleted spot/stockpile.
              if (onSpot) onSpot.set(ing.kind, (onSpot.get(ing.kind) ?? 0) - consumed);
              const stockHas = stockByKind.get(ing.kind) ?? 0;
              if (stockHas > 0) {
                stockByKind.set(ing.kind, Math.max(0, stockHas - consumed));
              }
            }
            furnace.activeBillId = bill.id;
            furnace.workTicksRemaining = recipe.workTicks;
            onCraftChange();
            break;
          }

          for (const ing of recipe.ingredients) {
            const have = onSpot?.get(ing.kind) ?? 0;
            const key = `${furnaceId}:${ing.kind}`;
            const inFlight = supplyInFlight.get(key) ?? 0;
            let need = ing.count - have - inFlight;
            while (need > 0) {
              const src = findNearestAvailableItem(
                world,
                grid,
                claimed,
                ing.kind,
                furnace.workI,
                furnace.workJ,
              );
              if (!src) break;
              board.post('supply', {
                itemId: src.id,
                kind: ing.kind,
                fromI: src.i,
                fromJ: src.j,
                toI: furnace.workI,
                toJ: furnace.workJ,
                furnaceId,
                toSupply: true,
              });
              claimed.set(src.id, (claimed.get(src.id) ?? 0) + 1);
              supplyInFlight.set(key, (supplyInFlight.get(key) ?? 0) + 1);
              need--;
            }
          }
          break;
        }
      }
    },
  };
}

/**
 * Remove `count` units of `kind` from items at (i, j). Drains stacks one at
 * a time, despawning emptied ones. Returns units actually consumed (may be
 * less than `count` if the tile didn't have enough).
 *
 * Collects target ids before mutating because despawn swap-removes from the
 * archetype, which would alias mid-iteration.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number} i @param {number} j
 * @param {string} kind
 * @param {number} count
 * @returns {number} units consumed
 */
function consumeFromTile(world, i, j, kind, count) {
  /** @type {number[]} */
  const ids = [];
  for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
    const a = components.TileAnchor;
    if (a.i !== i || a.j !== j) continue;
    if (components.Item.kind !== kind) continue;
    ids.push(id);
  }
  let remaining = count;
  for (const id of ids) {
    if (remaining <= 0) break;
    const item = world.get(id, 'Item');
    if (!item) continue;
    const take = Math.min(remaining, item.count);
    item.count -= take;
    remaining -= take;
    if (item.count <= 0) world.despawn(id);
  }
  return count - remaining;
}
