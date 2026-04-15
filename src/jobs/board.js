/**
 * Job board.
 *
 * Holds a queue of available jobs. The cow brain system asks for the nearest
 * unclaimed job each tick when a cow has nothing to do. Chop and haul jobs
 * post here; wander is synthesized by the brain when the board is empty.
 *
 * A job is { id, kind, tier, payload, claimedBy, completed }. `tier` is
 * derived from `kind` at post time (see src/jobs/tiers.js) and drives the
 * priority ordering in findUnclaimed — lower tier beats higher regardless of
 * distance. `payload` is opaque to the board.
 */

import { tierFor } from './tiers.js';

let _nextId = 1;

/**
 * @typedef Job
 * @property {number} id
 * @property {string} kind
 * @property {number} tier
 * @property {Record<string, any>} payload
 * @property {number | null} claimedBy
 * @property {boolean} completed
 */

export class JobBoard {
  constructor() {
    /** @type {Job[]} */
    this.jobs = [];
    /** @type {Map<number, Job>} */
    this.byId = new Map();
    // Bumped whenever the open-job pool changes in a way that might wake an
    // idle cow (post, release). Brains cache lastBoardVersion and skip the
    // board scan if it hasn't moved.
    this.version = 0;
  }

  /** @param {number} jobId */
  get(jobId) {
    return this.byId.get(jobId) ?? null;
  }

  /** Wipe all jobs (used by loadGame). */
  clear() {
    this.jobs.length = 0;
    this.byId.clear();
    this.version++;
  }

  /**
   * @param {string} kind
   * @param {Record<string, any>} [payload]
   * @returns {Job}
   */
  post(kind, payload = {}) {
    const job = {
      id: _nextId++,
      kind,
      tier: tierFor(kind),
      payload,
      claimedBy: null,
      completed: false,
    };
    this.jobs.push(job);
    this.byId.set(job.id, job);
    this.version++;
    return job;
  }

  /**
   * Find an unclaimed job. Ordering: lowest tier (most urgent) first, then
   * nearest by Chebyshev tile distance within the same tier. A tier-2 chop at
   * the far edge of the map still beats a tier-3 haul next door — urgency is
   * the primary axis.
   *
   * Pass `canClaim` to exclude jobs this caller can't take — e.g. paint jobs
   * locked to a specific artist cow. Skipped jobs don't affect ordering.
   *
   * @param {{ i: number, j: number }} [near]
   * @param {(job: Job) => boolean} [canClaim]
   */
  findUnclaimed(near, canClaim) {
    let best = null;
    let bestTier = Number.POSITIVE_INFINITY;
    let bestD = Number.POSITIVE_INFINITY;
    for (const job of this.jobs) {
      if (job.claimedBy !== null || job.completed) continue;
      if (canClaim && !canClaim(job)) continue;
      let d = 0;
      if (near && job.payload.i !== undefined && job.payload.j !== undefined) {
        d = Math.max(Math.abs(job.payload.i - near.i), Math.abs(job.payload.j - near.j));
      }
      if (job.tier < bestTier || (job.tier === bestTier && d < bestD)) {
        bestTier = job.tier;
        bestD = d;
        best = job;
      }
    }
    return best;
  }

  /**
   * @param {number} jobId
   * @param {number} entityId
   */
  claim(jobId, entityId) {
    const job = this.byId.get(jobId);
    if (!job || job.claimedBy !== null || job.completed) return false;
    job.claimedBy = entityId;
    return true;
  }

  /** @param {number} jobId */
  release(jobId) {
    const job = this.byId.get(jobId);
    if (!job) return;
    job.claimedBy = null;
    this.version++;
  }

  /** @param {number} jobId */
  complete(jobId) {
    const job = this.byId.get(jobId);
    if (!job) return;
    job.completed = true;
    // Bump so cows whose job got cancelled out from under them (e.g. chop
    // unmark) don't keep walking toward a dead target for another tick.
    this.version++;
  }

  /** Remove all completed jobs. Run periodically to keep the queue small. */
  reap() {
    const kept = [];
    for (const j of this.jobs) {
      if (j.completed) this.byId.delete(j.id);
      else kept.push(j);
    }
    this.jobs = kept;
  }

  get openCount() {
    return this.jobs.filter((j) => !j.completed && j.claimedBy === null).length;
  }
}
