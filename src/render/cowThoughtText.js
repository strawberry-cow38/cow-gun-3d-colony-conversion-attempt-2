/**
 * Shared mapping from a cow's current Job to a short human phrase — used by
 * both the floating in-world thought bubbles and the portrait bar so the two
 * stay in sync without either reaching into the other's module.
 */

/**
 * @param {{ kind: string, state: string }} job
 */
export function thoughtFor(job) {
  const { kind, state } = job;
  if (kind === 'eat') {
    if (state === 'eating') return 'munching';
    return 'hungry';
  }
  if (kind === 'chop') {
    if (state === 'chopping') return 'chopping';
    return 'to tree';
  }
  if (kind === 'haul' || kind === 'deliver') {
    if (state === 'walking-to-item' || state === 'pathing-to-item') return 'picking up';
    if (state === 'picking-up') return 'lifting';
    if (state === 'dropping') return 'dropping';
    return kind === 'deliver' ? 'delivering' : 'hauling';
  }
  if (kind === 'move') return 'moving';
  if (kind === 'wander') {
    if (state === 'idle') return 'idle';
    return 'wandering';
  }
  return kind;
}
