/**
 * Haul job plumbing.
 *
 * Posts a `haul` job for each loose Item unit that isn't already on a stockpile
 * tile and isn't already claimed by an open haul job. Each job reserves one
 * unit's worth of slot at a specific stockpile tile, so two cows can't race to
 * deposit on the same slot.
 *
 * Items are stacks: one entity = one stack of N units. Haul jobs pick up 1
 * unit at a time; the source item stays alive until its count hits zero.
 *
 * Payload:
 *   { itemId, kind, fromI, fromJ, toI, toJ }
 *
 * PICKUP_TICKS / DROP_TICKS give the cow a brief pause when interacting so the
 * motion reads as a real action instead of a teleport.
 */

import { maxStack } from '../world/items.js';

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
    if (j.completed || j.kind !== 'haul') continue;
    const idx = grid.idx(j.payload.toI, j.payload.toJ);
    const s = out.get(idx);
    if (!s) continue;
    if (s.kind === null) s.kind = j.payload.kind;
    s.count += 1;
  }
  return out;
}

/**
 * Count open claims against each item entity — both haul jobs on the board
 * and in-flight cow eat jobs. A stack of N can have up to N concurrent
 * haulers, but an eater walking to it also reserves one unit so the haul
 * poster doesn't strip food out from under a hungry cow.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('./board.js').JobBoard} board
 * @returns {Map<number, number>}  itemId → units claimed
 */
export function buildHaulTargetedCounts(world, board) {
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const j of board.jobs) {
    if (j.completed || j.kind !== 'haul') continue;
    const id = j.payload.itemId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
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
 * Pick the best stockpile slot for depositing one unit of `kind`, starting
 * from tile (i, j). Preference order:
 *   1. nearest tile already stacking `kind` with room,
 *   2. nearest empty stockpile tile.
 * Distance is Chebyshev.
 *
 * Mutates `slots` to reserve the chosen tile (count+1, kind set).
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {Map<number, TileSlotState>} slots
 * @param {string} kind
 * @param {number} i @param {number} j
 */
export function findAndReserveSlot(grid, slots, kind, i, j) {
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
  s.count += 1;
  const ti = pick % grid.W;
  const tj = (pick - ti) / grid.W;
  return { i: ti, j: tj };
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
 * Mutates `slots` to reserve one unit on the chosen tile.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {Map<number, TileSlotState>} slots
 * @param {StockpileStack[]} snapshot
 * @param {StockpileStack} src
 */
export function findAndReserveMergeTarget(grid, slots, snapshot, src) {
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
  slot.count += 1;
  const ti = bestIdx % grid.W;
  const tj = (bestIdx - ti) / grid.W;
  return { i: ti, j: tj };
}

/**
 * Rare-tier system: scan loose items, post haul jobs. A stack of N yields up
 * to N concurrent haul jobs (capped by available slots). Also runs a
 * consolidation pass that moves units between stockpile tiles to merge same-
 * kind half-stacks into taller ones.
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

      // Pass 1: loose items off stockpile → stockpile tiles.
      for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
        const a = components.TileAnchor;
        const item = components.Item;
        if (grid.isStockpile(a.i, a.j)) continue;
        const alreadyClaimed = targetedCounts.get(id) ?? 0;
        let need = item.count - alreadyClaimed;
        while (need > 0) {
          const target = findAndReserveSlot(grid, slots, item.kind, a.i, a.j);
          if (!target) break;
          board.post('haul', {
            itemId: id,
            kind: item.kind,
            fromI: a.i,
            fromJ: a.j,
            toI: target.i,
            toJ: target.j,
          });
          targetedCounts.set(id, (targetedCounts.get(id) ?? 0) + 1);
          need--;
        }
      }

      // Pass 2: consolidate existing stockpile stacks. Same-kind partial
      // stacks migrate one unit at a time into the "canonical" larger stack.
      const snapshot = snapshotStockpileStacks(world, grid);
      for (const src of snapshot) {
        const alreadyClaimed = targetedCounts.get(src.itemId) ?? 0;
        let need = src.count - alreadyClaimed;
        while (need > 0) {
          const target = findAndReserveMergeTarget(grid, slots, snapshot, src);
          if (!target) break;
          board.post('haul', {
            itemId: src.itemId,
            kind: src.kind,
            fromI: src.i,
            fromJ: src.j,
            toI: target.i,
            toJ: target.j,
          });
          targetedCounts.set(src.itemId, (targetedCounts.get(src.itemId) ?? 0) + 1);
          need--;
        }
      }
    },
  };
}
