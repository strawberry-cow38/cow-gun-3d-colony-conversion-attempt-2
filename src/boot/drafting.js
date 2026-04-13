/**
 * Drafting: flip cow `drafted` state and bookkeeping. Drafted cows stand still
 * until the player moves them; undrafted cows return to autonomous brain work.
 */

/**
 * Flip the `drafted` flag on each cow. Mixed selections all go to "drafted"
 * (so one press never silently drafts half the crowd and un-drafts the rest);
 * if everyone is already drafted, the press releases them.
 *
 * Cows transitioning INTO drafted stop immediately — path cleared, velocity
 * zeroed. Any jobs they'd claimed (chop/haul/eat) get released back to the
 * board via the brain on its next tick.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number[]} cowIds
 */
export function toggleDraft(world, cowIds) {
  const ids = [];
  for (const id of cowIds) {
    if (world.get(id, 'Cow')) ids.push(id);
  }
  if (ids.length === 0) return;
  const allDrafted = ids.every((id) => world.get(id, 'Cow')?.drafted === true);
  const target = !allDrafted;
  for (const id of ids) {
    const c = world.get(id, 'Cow');
    if (!c) continue;
    const becomingDrafted = target === true && c.drafted !== true;
    c.drafted = target;
    // Either direction wakes the brain so it notices the flip next tick —
    // drafted-becoming runs the cleanup branch, released cows re-evaluate.
    const brain = world.get(id, 'Brain');
    if (brain) brain.jobDirty = true;
    if (becomingDrafted) {
      // Stop visually this frame: clear the path so cowFollowPath can't give
      // them fresh velocity, and zero the current velocity so the next
      // applyVelocity step doesn't carry them forward. Job cleanup (releasing
      // chop/haul claims, dropping carried items) happens in the brain's
      // drafted branch on the next tick using the existing code path.
      const path = world.get(id, 'Path');
      const vel = world.get(id, 'Velocity');
      if (path) {
        path.steps = [];
        path.index = 0;
      }
      if (vel) {
        vel.x = 0;
        vel.z = 0;
      }
    }
  }
}

/** @param {import('../ecs/world.js').World} world */
export function countDrafted(world) {
  let n = 0;
  for (const { components } of world.query(['Cow'])) {
    if (components.Cow.drafted) n++;
  }
  return n;
}
