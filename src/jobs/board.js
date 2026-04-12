/**
 * Job board.
 *
 * Holds a queue of available jobs. The cow brain system asks for the nearest
 * unclaimed job each tick when a cow has nothing to do. Phase 3 only generates
 * Wander jobs internally (cow brain auto-wanders when idle), but the board
 * is the seam where designated work (chop, haul, build) will plug in later.
 *
 * A job is { id, kind, payload, claimedBy, completed }. `payload` is opaque to
 * the board; the job's tick handler interprets it.
 */

let _nextId = 1;

/**
 * @typedef Job
 * @property {number} id
 * @property {string} kind
 * @property {Record<string, any>} payload
 * @property {number | null} claimedBy
 * @property {boolean} completed
 */

export class JobBoard {
  constructor() {
    /** @type {Job[]} */
    this.jobs = [];
  }

  /**
   * @param {string} kind
   * @param {Record<string, any>} [payload]
   * @returns {Job}
   */
  post(kind, payload = {}) {
    const job = { id: _nextId++, kind, payload, claimedBy: null, completed: false };
    this.jobs.push(job);
    return job;
  }

  /**
   * Find an unclaimed job of any kind. Optional priority: nearest by Chebyshev
   * tile distance to (i, j) when both job and `near` are tile-anchored.
   * @param {{ i: number, j: number }} [near]
   */
  findUnclaimed(near) {
    let best = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const job of this.jobs) {
      if (job.claimedBy !== null || job.completed) continue;
      let d = 0;
      if (near && job.payload.i !== undefined && job.payload.j !== undefined) {
        d = Math.max(Math.abs(job.payload.i - near.i), Math.abs(job.payload.j - near.j));
      }
      if (d < bestD) {
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
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || job.claimedBy !== null || job.completed) return false;
    job.claimedBy = entityId;
    return true;
  }

  /** @param {number} jobId */
  release(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.claimedBy = null;
  }

  /** @param {number} jobId */
  complete(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    job.completed = true;
  }

  /** Remove all completed jobs. Run periodically to keep the queue small. */
  reap() {
    this.jobs = this.jobs.filter((j) => !j.completed);
  }

  get openCount() {
    return this.jobs.filter((j) => !j.completed && j.claimedBy === null).length;
  }
}
