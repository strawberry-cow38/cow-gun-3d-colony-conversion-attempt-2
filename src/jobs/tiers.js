/**
 * Job tier priorities. Lower number = more urgent.
 *
 *   0  emergency — flee, danger (future)
 *   1  self-care — eat (self-assigned, not board-backed)
 *   2  player-directed — chop, move-to
 *   3  autonomous work — haul
 *   4  idle — wander
 *   5  no job — the cow literally has nothing assigned
 *
 * Board-posted jobs inherit the tier of their kind. The brain uses tiers to:
 *   - Pick the highest-priority open job from the board (chop before haul when
 *     both are available and equally close).
 *   - Preempt non-urgent work when vitals spike (hunger < critical → release
 *     the board claim mid-task so next tick re-plans as an eat job).
 *
 * Adding a new job kind: add it here, then posters at src/jobs/*.js or
 * src/render/*.js pick it up automatically via `tierFor(kind)` in the board.
 */

/** @type {Record<string, number>} */
export const JOB_TIERS = {
  eat: 1,
  chop: 2,
  cut: 2,
  mine: 2,
  move: 2,
  build: 2,
  deconstruct: 2,
  till: 2,
  plant: 2,
  harvest: 2,
  haul: 3,
  wander: 4,
  none: 5,
};

/** @param {string} kind */
export function tierFor(kind) {
  return JOB_TIERS[kind] ?? 5;
}

/**
 * Hunger level below which the brain preempts any tier ≥ `HUNGER_PREEMPT_TIER`
 * job to go eat. Distinct from (and stricter than) HUNGER_EAT_THRESHOLD, which
 * governs the softer "prefer eat over wander" behavior.
 */
export const HUNGER_CRITICAL_THRESHOLD = 0.2;

/** Jobs at or above this tier (less urgent) get preempted by critical hunger. */
export const HUNGER_PREEMPT_TIER = 2;
