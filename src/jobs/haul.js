/**
 * Haul job plumbing. Two kinds share the same pickup→drop state machine but
 * live at different tiers so the brain ranks them correctly:
 *
 *   `deliver` (tier 2, player-designated) — carry an item to a BuildSite so
 *     construction can proceed. Ranks alongside chop/mine/build, ahead of
 *     generic hauls, so cows don't gut the stockpile instead of walling up
 *     the base.
 *   `haul` (tier 3, autonomous) — loose→stockpile, stockpile consolidation,
 *     and blueprint-clear relocations. Anything that isn't building.
 *
 * Items are stacks: one entity = one stack of N units. A job bundles `count`
 * units into one trip — the cow picks up as many as she can carry in one go
 * (bounded by carry weight). Any remainder stays on the source tile and the
 * poster re-posts a new bundled job on the next tick, so a second cow can
 * help in parallel.
 *
 * Payload: { itemId, kind, count, fromI, fromJ, toI, toJ, toBuildSite?, toRelocation?, siteId? }
 *
 * PICKUP_TICKS / DROP_TICKS give the cow a brief pause when interacting so the
 * motion reads as a real action instead of a teleport.
 */

import { defaultWalkable } from '../sim/pathfinding.js';
import { roofIsSupported } from '../systems/autoRoof.js';
import { maxStack, stackCount } from '../world/items.js';

export const PICKUP_TICKS = 12;
export const DROP_TICKS = 9;

/**
 * @typedef TileSlotState
 * @property {string | null} kind   the kind stacked/reserved on this tile, or null if empty
 * @property {number} count         units already on the tile + units reserved by open haul jobs
 */

/**
 * Compute the per-tile stockpile slot state across all stockpile tiles,
 * folding in both existing Items and open haul reservations.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('./board.js').JobBoard} board
 * @returns {Map<number, TileSlotState>}  tileIdx → state
 */
export function computeStockpileSlots(world, grid, board) {
  /** @type {Map<number, TileSlotState>} */
  const out = new Map();
  for (let j = 0; j < grid.H; j++) {
    for (let i = 0; i < grid.W; i++) {
      if (grid.isStockpile(i, j)) out.set(grid.idx(i, j), { kind: null, count: 0 });
    }
  }
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    const a = components.TileAnchor;
    const s = out.get(grid.idx(a.i, a.j));
    if (!s) continue;
    s.kind = components.Item.kind;
    s.count = components.Item.count;
  }
  for (const j of board.jobs) {
    if (j.completed) continue;
    if (j.kind !== 'haul' && j.kind !== 'deliver') continue;
    const idx = grid.idx(j.payload.toI, j.payload.toJ);
    const s = out.get(idx);
    if (!s) continue;
    if (s.kind === null) s.kind = j.payload.kind;
    s.count += j.payload.count ?? 1;
  }
  return out;
}

/**
 * Count open claims against each item entity — both haul jobs on the board
 * and in-flight cow eat jobs. Bundled hauls claim `payload.count` units per
 * job, so a 50-wood stack typically yields one 50-unit job (not 50 jobs) and
 * only a second hauler runs if the first cow's trip left leftovers behind.
 * Eaters count as 1 unit each so the haul poster doesn't strip food out from
 * under a hungry cow.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./board.js').JobBoard} board
 * @returns {Map<number, number>}  itemId → units claimed
 */
export function buildHaulTargetedCounts(world, board) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const j of board.jobs) {
    if (j.completed) continue;
    if (j.kind !== 'haul' && j.kind !== 'deliver' && j.kind !== 'supply') continue;
    // Haul-from-furnace jobs have no source Item entity — skip them.
    if (typeof j.payload.itemId !== 'number') continue;
    const id = j.payload.itemId;
    counts.set(id, (counts.get(id) ?? 0) + (j.payload.count ?? 1));
  }
  for (const { components } of world.query(['Cow', 'Job'])) {
    const job = components.Job;
    if (job.kind !== 'eat') continue;
    const id = job.payload.itemId;
    if (typeof id !== 'number') continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Pick the best stockpile slot for depositing up to `want` units of `kind`,
 * starting from tile (i, j). Preference order:
 *   1. nearest tile already stacking `kind` with room,
 *   2. nearest empty stockpile tile.
 * Distance is Chebyshev.
 *
 * Mutates `slots` to reserve the chosen tile (count += reserved, kind set).
 * Returns the picked tile and the number of units actually reserved, which is
 * `min(want, cap - slot.count)` — may be less than `want` when the slot can't
 * fit the full stack.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {Map<number, TileSlotState>} slots
 * @param {string} kind
 * @param {number} i @param {number} j
 * @param {number} want  desired units to reserve (> 0)
 */
export function findAndReserveSlot(grid, slots, kind, i, j, want) {
  const cap = maxStack(kind);
  let bestSameKind = null;
  let bestSameD = Number.POSITIVE_INFINITY;
  let bestEmpty = null;
  let bestEmptyD = Number.POSITIVE_INFINITY;
  for (const [idx, s] of slots) {
    const ti = idx % grid.W;
    const tj = (idx - ti) / grid.W;
    const d = Math.max(Math.abs(ti - i), Math.abs(tj - j));
    if (s.kind === kind && s.count < cap) {
      if (d < bestSameD) {
        bestSameD = d;
        bestSameKind = idx;
      }
    } else if (s.kind === null) {
      if (d < bestEmptyD) {
        bestEmptyD = d;
        bestEmpty = idx;
      }
    }
  }
  const pick = bestSameKind ?? bestEmpty;
  if (pick === null) return null;
  const s = /** @type {TileSlotState} */ (slots.get(pick));
  if (s.kind === null) s.kind = kind;
  const reserve = Math.min(want, cap - s.count);
  s.count += reserve;
  const ti = pick % grid.W;
  const tj = (pick - ti) / grid.W;
  return { i: ti, j: tj, count: reserve };
}

/**
 * @typedef StockpileStack
 * @property {number} itemId
 * @property {number} i @property {number} j
 * @property {string} kind
 * @property {number} count    count at snapshot time (before reservations)
 */

/**
 * Snapshot the original counts of every stockpile-tile stack. Using a snapshot
 * (rather than live counts) keeps the strict-ordering rule in the
 * consolidation pass from flip-flopping as pass-1 reservations bump slots.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {StockpileStack[]}
 */
export function snapshotStockpileStacks(world, grid) {
  /** @type {StockpileStack[]} */
  const out = [];
  for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
    const a = components.TileAnchor;
    if (!grid.isStockpile(a.i, a.j)) continue;
    if (components.Item.forbidden) continue;
    out.push({
      itemId: id,
      i: a.i,
      j: a.j,
      kind: components.Item.kind,
      count: components.Item.count,
    });
  }
  return out;
}

/**
 * Pick a consolidation destination for `src`: the nearest stockpile stack of
 * the same kind with strictly more units (ties broken by itemId so the pair
 * only posts one direction and never thrashes), and with room left under cap.
 *
 * Mutates `slots` to reserve up to `want` units on the chosen tile. Returns
 * the picked tile and the number reserved (`min(want, cap - slot.count)`).
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {Map<number, TileSlotState>} slots
 * @param {StockpileStack[]} snapshot
 * @param {StockpileStack} src
 * @param {number} want  desired units to reserve (> 0)
 */
export function findAndReserveMergeTarget(grid, slots, snapshot, src, want) {
  const cap = maxStack(src.kind);
  let bestIdx = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const dst of snapshot) {
    if (dst.itemId === src.itemId) continue;
    if (dst.kind !== src.kind) continue;
    // Strict (count, itemId) ordering: src merges INTO the "larger" partner,
    // and the reverse pair rejects its half, so the two cows never swap.
    if (dst.count < src.count) continue;
    if (dst.count === src.count && dst.itemId <= src.itemId) continue;
    const dstIdx = grid.idx(dst.i, dst.j);
    const slot = slots.get(dstIdx);
    if (!slot || slot.count >= cap) continue;
    const d = Math.max(Math.abs(dst.i - src.i), Math.abs(dst.j - src.j));
    if (d < bestD) {
      bestD = d;
      bestIdx = dstIdx;
    }
  }
  if (bestIdx === null) return null;
  const slot = /** @type {TileSlotState} */ (slots.get(bestIdx));
  const reserve = Math.min(want, cap - slot.count);
  slot.count += reserve;
  const ti = bestIdx % grid.W;
  const tj = (bestIdx - ti) / grid.W;
  return { i: ti, j: tj, count: reserve };
}

/**
 * Count material in-flight to every BuildSite — both open deliver jobs (the
 * cow hasn't picked up yet) and cows already carrying their load. Returned
 * as a map tileIdx → units so the poster knows how many more to dispatch.
 *
 * Why count the already-carried portion: `releaseHaulClaim` zeroes the
 * board job's `payload.count` the moment a cow picks up, so relying on
 * `payload.count` alone makes the poster think the site has no in-flight
 * supply the instant the cow grabs her stack — and it dispatches a second
 * hauler for a site that's already fully supplied.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./board.js').JobBoard} board
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {Map<number, number>}
 */
export function buildSiteInFlight(world, board, grid) {
  /** @type {Map<number, number>} */
  const out = new Map();
  for (const j of board.jobs) {
    if (j.completed || j.kind !== 'deliver') continue;
    if (!j.payload.toBuildSite) continue;
    const idx = grid.idx(j.payload.toI, j.payload.toJ);
    out.set(idx, (out.get(idx) ?? 0) + (j.payload.count ?? 1));
  }
  for (const { components } of world.query(['Cow', 'Job', 'Inventory'])) {
    const job = components.Job;
    if (job.kind !== 'deliver' || !job.payload.toBuildSite) continue;
    const carried = stackCount(components.Inventory.items, job.payload.kind);
    if (carried === 0) continue;
    const idx = grid.idx(job.payload.toI, job.payload.toJ);
    out.set(idx, (out.get(idx) ?? 0) + carried);
  }
  return out;
}

/**
 * Pick the nearest item stack of `kind` with at least one unclaimed unit.
 * Prefers loose items over stockpile stacks so we don't gut the stockpile
 * before the ground has been cleared.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {Map<number, number>} claimed  itemId → already-claimed units (mutated)
 * @param {string} kind
 * @param {number} i @param {number} j
 */
export function findNearestAvailableItem(world, grid, claimed, kind, i, j) {
  let bestLoose = null;
  let bestLooseD = Number.POSITIVE_INFINITY;
  let bestStock = null;
  let bestStockD = Number.POSITIVE_INFINITY;
  for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
    const item = components.Item;
    if (item.kind !== kind) continue;
    if (item.forbidden) continue;
    const avail = item.count - (claimed.get(id) ?? 0);
    if (avail <= 0) continue;
    const a = components.TileAnchor;
    const d = Math.max(Math.abs(a.i - i), Math.abs(a.j - j));
    if (grid.isStockpile(a.i, a.j)) {
      if (d < bestStockD) {
        bestStockD = d;
        bestStock = { id, i: a.i, j: a.j, avail };
      }
    } else if (d < bestLooseD) {
      bestLooseD = d;
      bestLoose = { id, i: a.i, j: a.j, avail };
    }
  }
  return bestLoose ?? bestStock;
}

/**
 * Total unclaimed units of every (non-forbidden) kind on the map. Sums
 * `item.count - claimed[id]` across all Item entities. Used by bill posters
 * to pre-check whether a recipe is fully sourceable before committing to
 * any supply haul — prevents "2 coal in the furnace with no ore mined"
 * partial-supply deadlocks.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {Map<number, number>} claimed  itemId → already-claimed units
 * @returns {Map<string, number>}  kind → available units
 */
export function totalAvailableByKind(world, claimed) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
    const item = components.Item;
    if (item.forbidden) continue;
    const avail = item.count - (claimed.get(id) ?? 0);
    if (avail <= 0) continue;
    out.set(item.kind, (out.get(item.kind) ?? 0) + avail);
  }
  return out;
}

/**
 * Find the nearest walkable tile to (i, j) that is not itself a blueprint
 * tile and not already reserved by an in-flight relocation. Used to pick a
 * drop spot for forbidden stacks blocking a wall blueprint.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {Set<number>} blueprintTiles    tile indices to avoid
 * @param {Set<number>} reservedDropTiles tile indices already dispatched this tick
 * @param {number} i @param {number} j
 */
function findRelocationTile(grid, blueprintTiles, reservedDropTiles, i, j) {
  // Ring search outward from (i, j); stop at the first acceptable tile. Max
  // radius = grid diameter so we always find something on any non-degenerate
  // map.
  const maxR = Math.max(grid.W, grid.H);
  for (let r = 1; r <= maxR; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const ni = i + di;
        const nj = j + dj;
        if (!grid.inBounds(ni, nj)) continue;
        if (!defaultWalkable(grid, ni, nj)) continue;
        const idx = grid.idx(ni, nj);
        if (blueprintTiles.has(idx)) continue;
        if (reservedDropTiles.has(idx)) continue;
        return { i: ni, j: nj };
      }
    }
  }
  return null;
}

/**
 * Rare-tier system: scan loose items, post haul jobs. Each job bundles all
 * the units a cow can move in one trip (bounded by the destination slot's
 * remaining room), so a 50-wood pile typically becomes a single haul rather
 * than 50 micro-jobs. Leftovers the first cow can't fit in her pack stay on
 * the source tile and get re-posted next tick. Also runs a consolidation
 * pass that moves units between stockpile tiles to merge same-kind half-
 * stacks into taller ones.
 *
 * BuildSites get first dibs: any site short on materials queues haul-to-site
 * jobs before the stockpile passes run. Once a site is fully delivered and
 * doesn't already have one, a `build` job is posted so a cow comes to erect
 * the wall.
 *
 * @param {import('./board.js').JobBoard} board
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeHaulPostingSystem(board, grid) {
  return {
    name: 'haulPoster',
    tier: 'rare',
    run(world) {
      const slots = computeStockpileSlots(world, grid, board);
      const targetedCounts = buildHaulTargetedCounts(world, board);
      const siteInFlight = buildSiteInFlight(world, board, grid);

      /** Tiles hosting any pending BuildSite — reused by the blueprint-clear pass. */
      /** @type {Set<number>} */
      const blueprintTiles = new Set();
      /** Wall-blueprint tile coords — only walls block pathing post-build and thus need clearing. */
      /** @type {{ i: number, j: number }[]} */
      const wallBlueprintTiles = [];

      // Pass 0a: BuildSites short on materials. Post one haul-to-site per
      // deficit unit, picking the nearest available stack of requiredKind.
      for (const { id: siteId, components } of world.query(['BuildSite', 'TileAnchor'])) {
        const site = components.BuildSite;
        const a = components.TileAnchor;
        blueprintTiles.add(grid.idx(a.i, a.j));
        if (site.kind === 'wall') wallBlueprintTiles.push({ i: a.i, j: a.j });
        // Forbidden blueprints are inert: no deliveries, no build job. Already-
        // delivered materials stay on the tile until the player un-forbids or
        // cancels. Keeping them in the wallBlueprintTiles loop above so the
        // forbidden-stack-clear pass still unblocks wall footings.
        if (site.forbidden) continue;
        // Door-over-wall: don't haul resources onto the tile until the wall's
        // gone. Otherwise the item would land on a blocked tile the haulers
        // can't pathfind back to.
        if (site.kind === 'door' && grid.isWall(a.i, a.j)) continue;
        const idx = grid.idx(a.i, a.j);
        const pending = siteInFlight.get(idx) ?? 0;
        let need = site.required - site.delivered - pending;
        while (need > 0) {
          const src = findNearestAvailableItem(
            world,
            grid,
            targetedCounts,
            site.requiredKind,
            a.i,
            a.j,
          );
          if (!src) break;
          const bundle = Math.min(need, src.avail);
          board.post('deliver', {
            itemId: src.id,
            kind: site.requiredKind,
            count: bundle,
            fromI: src.i,
            fromJ: src.j,
            toI: a.i,
            toJ: a.j,
            toBuildSite: true,
            siteId,
          });
          targetedCounts.set(src.id, (targetedCounts.get(src.id) ?? 0) + bundle);
          siteInFlight.set(idx, (siteInFlight.get(idx) ?? 0) + bundle);
          need -= bundle;
        }

        // Pass 0b: fully-delivered sites with no build job yet → post one.
        // Roof sites additionally require the tile to be valid (supported +
        // within reach) — blueprints on invalid tiles wait until a nearby
        // wall/roof makes them valid, or the player cancels them.
        if (site.delivered >= site.required && site.buildJobId === 0) {
          if (site.kind === 'roof' && !roofIsSupported(grid, a.i, a.j)) continue;
          // Doors placed over walls wait for the wall deconstruct to finish.
          // Once the wall's gone (setWall(0)) the next poster tick posts this.
          if (site.kind === 'door' && grid.isWall(a.i, a.j)) continue;
          const job = board.post('build', { siteId, i: a.i, j: a.j });
          site.buildJobId = job.id;
        }
      }

      // Pass 1: loose items off stockpile → stockpile tiles. While iterating
      // we also index forbidden stacks by tile so the blueprint-clear pass
      // below is an O(1) lookup per wall site instead of another full scan.
      /** @type {Map<number, { id: number, kind: string, count: number }>} */
      const forbiddenByTile = new Map();
      for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
        const a = components.TileAnchor;
        const item = components.Item;
        if (item.forbidden) {
          forbiddenByTile.set(grid.idx(a.i, a.j), { id, kind: item.kind, count: item.count });
          continue;
        }
        // Paintings carry per-entity metadata (title, palette, artist). The
        // generic haul flow despawns the source on pickup and spawns a fresh
        // Item at the destination, which would drop the Painting component.
        // Skip paintings here until a metadata-preserving haul path exists.
        if (item.kind === 'painting') continue;
        if (grid.isStockpile(a.i, a.j)) continue;
        const alreadyClaimed = targetedCounts.get(id) ?? 0;
        let need = item.count - alreadyClaimed;
        while (need > 0) {
          const target = findAndReserveSlot(grid, slots, item.kind, a.i, a.j, need);
          if (!target) break;
          board.post('haul', {
            itemId: id,
            kind: item.kind,
            count: target.count,
            fromI: a.i,
            fromJ: a.j,
            toI: target.i,
            toJ: target.j,
          });
          targetedCounts.set(id, (targetedCounts.get(id) ?? 0) + target.count);
          need -= target.count;
        }
      }

      // Pass 1b: blueprint-clear. Walls bake into unwalkable tiles once
      // built, so any forbidden stack on a wall blueprint would be sealed
      // in. Other blueprint kinds (door/roof/floor/torch) stay walkable.
      /** @type {Set<number>} */
      const reservedDropTiles = new Set();
      for (const { i, j } of wallBlueprintTiles) {
        const blocker = forbiddenByTile.get(grid.idx(i, j));
        if (!blocker) continue;
        const alreadyClaimed = targetedCounts.get(blocker.id) ?? 0;
        const need = blocker.count - alreadyClaimed;
        if (need <= 0) continue;
        const drop = findRelocationTile(grid, blueprintTiles, reservedDropTiles, i, j);
        if (!drop) continue;
        board.post('haul', {
          itemId: blocker.id,
          kind: blocker.kind,
          count: need,
          fromI: i,
          fromJ: j,
          toI: drop.i,
          toJ: drop.j,
          toRelocation: true,
        });
        targetedCounts.set(blocker.id, alreadyClaimed + need);
        reservedDropTiles.add(grid.idx(drop.i, drop.j));
      }

      // Pass 2: consolidate existing stockpile stacks. Same-kind partial
      // stacks migrate one unit at a time into the "canonical" larger stack.
      const snapshot = snapshotStockpileStacks(world, grid);
      for (const src of snapshot) {
        const alreadyClaimed = targetedCounts.get(src.itemId) ?? 0;
        let need = src.count - alreadyClaimed;
        while (need > 0) {
          const target = findAndReserveMergeTarget(grid, slots, snapshot, src, need);
          if (!target) break;
          board.post('haul', {
            itemId: src.itemId,
            kind: src.kind,
            count: target.count,
            fromI: src.i,
            fromJ: src.j,
            toI: target.i,
            toJ: target.j,
          });
          targetedCounts.set(src.itemId, (targetedCounts.get(src.itemId) ?? 0) + target.count);
          need -= target.count;
        }
      }
    },
  };
}
