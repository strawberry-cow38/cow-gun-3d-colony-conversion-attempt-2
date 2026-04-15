/**
 * Drafting: flip cow `drafted` state and bookkeeping. Drafted cows stand still
 * until the player moves them; undrafted cows return to autonomous brain work.
 */

import { worldToTileClamp } from '../world/coords.js';
import { addItemsToTile } from '../world/items.js';

/**
 * Flip the `drafted` flag on each cow. Mixed selections all go to "drafted"
 * (so one press never silently drafts half the crowd and un-drafts the rest);
 * if everyone is already drafted, the press releases them.
 *
 * Cows transitioning INTO drafted stop immediately — path cleared, velocity
 * zeroed — and synchronously drop any item they're hauling so the player
 * sees it hit the ground the moment they grab the reins, instead of waiting
 * for the next brain tick.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number[]} cowIds
 * @param {{ grid?: import('../world/tileGrid.js').TileGrid, onItemChange?: () => void }} [opts]
 */
export function toggleDraft(world, cowIds, opts = {}) {
  const ids = [];
  for (const id of cowIds) {
    if (world.get(id, 'Cow')) ids.push(id);
  }
  if (ids.length === 0) return;
  const allDrafted = ids.every((id) => world.get(id, 'Cow')?.drafted === true);
  const target = !allDrafted;
  let dropped = false;
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
      // applyVelocity step doesn't carry them forward.
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
      // Drop hauled items immediately so there's no one-tick window where the
      // player-controlled cow is still clutching a log.
      const inv = world.get(id, 'Inventory');
      const pos = world.get(id, 'Position');
      if (opts.grid && inv && pos && inv.items.length > 0) {
        const { i, j } = worldToTileClamp(pos.x, pos.z, opts.grid.W, opts.grid.H);
        for (const stack of inv.items) {
          addItemsToTile(world, opts.grid, stack.kind, stack.count, i, j);
        }
        inv.items.length = 0;
        dropped = true;
      }
    }
  }
  if (dropped) opts.onItemChange?.();
}

/** @param {import('../ecs/world.js').World} world */
export function countDrafted(world) {
  let n = 0;
  for (const { components } of world.query(['Cow'])) {
    if (components.Cow.drafted) n++;
  }
  return n;
}
