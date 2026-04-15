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
    // player is pointing at when clicking the wood pile.
    if (j0b.kind === 'haul' || j0b.kind === 'deliver' || j0b.kind === 'supply') {
      if (p.fromI === i && p.fromJ === j) out.push(j0b);
    } else if (p.i === i && p.j === j) {
      out.push(j0b);
    }
  }
  return out;
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
