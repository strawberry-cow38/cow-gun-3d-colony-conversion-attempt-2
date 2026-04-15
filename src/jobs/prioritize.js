/**
 * Force-assign a board job to a specific cow ("prioritize", rimworld-style).
 *
 * If another cow already claims the job they get kicked back to idle; their
 * brain will re-decide next tick (and drop any carried inventory via the
 * brain preamble's "not in a haul job but holding stuff" handler).
 *
 * The selected cow's current board claim (if any) is released so the old
 * work goes back into the pool for another cow to pick up.
 *
 * After reassignment we clear `brain.jobDirty` and sync `lastBoardVersion`
 * so the brain's decide-gate doesn't immediately re-pick a different job on
 * top of the prioritization.
 */

import { JOB_KINDS_AT_TILE } from './atTile.js';
import { buildHaulTargetedCounts, computeStockpileSlots, findAndReserveSlot } from './haul.js';

/**
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {number} i
 * @param {number} j
 * @returns {import('./board.js').Job[]}
 */
export function findPrioritizableJobsAtTile(board, i, j) {
  const out = [];
  for (const j0b of board.jobs) {
    if (j0b.completed) continue;
    if (!JOB_KINDS_AT_TILE.has(j0b.kind)) continue;
    const p = j0b.payload;
    // Haul-family matches on source tile (the item pickup) — that's what the
    // player is pointing at when clicking the wood pile. Post-pickup hauls
    // (payload.count === 0) are hidden: the cargo is already off the stack
    // and re-assigning would just force the carrier to drop mid-trip.
    if (j0b.kind === 'haul' || j0b.kind === 'deliver' || j0b.kind === 'supply') {
      if (p.count === 0) continue;
      if (p.fromI === i && p.fromJ === j) out.push(j0b);
    } else if (p.i === i && p.j === j) {
      out.push(j0b);
    }
  }
  return out;
}

/**
 * True when (i, j) hosts a loose, unforbidden Item that the haul poster would
 * move. Used by the context menu to decide between offering an ad-hoc
 * "Prioritize haul" and the disabled "no stockpile" hint.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 */
export function findHaulableItemAtTile(world, grid, i, j) {
  if (grid.isStockpile(i, j)) return null;
  for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
    const a = components.TileAnchor;
    if (a.i !== i || a.j !== j) continue;
    if (components.Item.forbidden) continue;
    return { id, kind: components.Item.kind, count: components.Item.count };
  }
  return null;
}

/**
 * Post a fresh bundled haul for the Item at (i, j) and immediately assign it
 * to `cowId`. Used when the player right-click-prioritizes a stack before the
 * rare-tier poster has had a chance to post one itself. Returns the new job
 * on success, or null if the tile has no haulable stack or no stockpile slot
 * can be reserved.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {number} cowId
 * @param {number} i @param {number} j
 */
export function postAndPrioritizeHaul(world, grid, board, cowId, i, j) {
  const item = findHaulableItemAtTile(world, grid, i, j);
  if (!item) return null;
  const claimed = buildHaulTargetedCounts(world, board).get(item.id) ?? 0;
  const want = item.count - claimed;
  if (want <= 0) return null;
  const slots = computeStockpileSlots(world, grid, board);
  const target = findAndReserveSlot(grid, slots, item.kind, i, j, want);
  if (!target) return null;
  const job = board.post('haul', {
    itemId: item.id,
    kind: item.kind,
    count: target.count,
    fromI: i,
    fromJ: j,
    toI: target.i,
    toJ: target.j,
  });
  if (!prioritizeJob(world, board, job.id, cowId)) {
    board.complete(job.id);
    return null;
  }
  return job;
}

/**
 * True when there's at least one stockpile slot available for `kind`.
 * Cheap pre-flight for the context menu: if false, show "No stockpile
 * available to haul to" instead of a click that would just deny.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} board
 * @param {string} kind
 * @param {number} i @param {number} j
 */
export function stockpileSlotAvailable(world, grid, board, kind, i, j) {
  const slots = computeStockpileSlots(world, grid, board);
  return findAndReserveSlot(grid, slots, kind, i, j, 1) !== null;
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('./board.js').JobBoard} board
 * @param {number} jobId
 * @param {number} cowId
 * @returns {boolean} true on success, false if the job or cow is unusable
 */
export function prioritizeJob(world, board, jobId, cowId) {
  const job = board.get(jobId);
  if (!job || job.completed) return false;
  const cowJob = world.get(cowId, 'Job');
  const cowPath = world.get(cowId, 'Path');
  const cowBrain = world.get(cowId, 'Brain');
  if (!cowJob || !cowPath || !cowBrain) return false;

  // Release whatever the selected cow is currently claiming (if anything).
  if (cowJob.payload?.jobId && cowJob.payload.jobId !== jobId) {
    board.release(cowJob.payload.jobId);
  }

  // Kick the job's current claimer, if any, back to idle.
  if (job.claimedBy !== null && job.claimedBy !== cowId) {
    const oldJob = world.get(job.claimedBy, 'Job');
    const oldPath = world.get(job.claimedBy, 'Path');
    const oldBrain = world.get(job.claimedBy, 'Brain');
    if (oldJob) {
      oldJob.kind = 'none';
      oldJob.state = 'idle';
      oldJob.payload = {};
    }
    if (oldPath) {
      oldPath.steps = [];
      oldPath.index = 0;
    }
    if (oldBrain) oldBrain.jobDirty = true;
  }

  // Reassign atomically — can't use board.claim because claimedBy may not be null.
  job.claimedBy = cowId;
  board.version++;

  cowJob.kind = job.kind;
  cowJob.state = startStateFor(job.kind);
  cowJob.payload = { ...job.payload, jobId: job.id };
  cowPath.steps = [];
  cowPath.index = 0;
  cowBrain.jobDirty = false;
  cowBrain.vitalsDirty = false;
  cowBrain.lastBoardVersion = board.version;
  return true;
}

/** @param {string} kind */
function startStateFor(kind) {
  if (kind === 'haul' || kind === 'deliver' || kind === 'supply') return 'pathing-to-item';
  return 'pathing';
}
