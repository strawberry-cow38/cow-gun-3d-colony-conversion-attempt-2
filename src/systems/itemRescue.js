/**
 * Relocates items stranded on tiles cows can't reach. Any tile item whose
 * anchor lands on an occupancy-blocked or wall tile gets moved to a cardinal-
 * adjacent walkable tile so the haul poster can actually haul it away.
 *
 * Common cause: furnaces (and other buildings) block their tile on spawn.
 * If an item was on that tile at build time, or if some legacy code path
 * dropped cargo onto the body tile directly, the stack became un-reachable
 * — cows path to workable tiles only, so the job board can't route them
 * through a blocked tile to pick it up. This sweep cleans those up.
 *
 * Rare tier (every 8 ticks): blocked-tile items are a slow leak, not a hot
 * path, and same-kind stacks land on adjacent tiles where the haul system
 * picks them up normally on the next cycle.
 */

import { findAdjacentWalkable } from '../jobs/chop.js';
import { tileToWorld } from '../world/coords.js';

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {() => void} [onRelocated]  fires (once) on any tick that moved an
 *   item so callers can flag the item instancer dirty.
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeItemRescueSystem(grid, onRelocated) {
  const walkable = (
    /** @type {import('../world/tileGrid.js').TileGrid} */ g,
    /** @type {number} */ i,
    /** @type {number} */ j,
  ) => !g.isBlocked(i, j);
  return {
    name: 'itemRescue',
    tier: 'rare',
    run(world) {
      let any = false;
      for (const { components } of world.query(['Item', 'TileAnchor', 'Position'])) {
        const a = components.TileAnchor;
        if (!grid.isBlocked(a.i, a.j)) continue;
        const adj = findAdjacentWalkable(grid, walkable, a.i, a.j);
        if (!adj) continue;
        a.i = adj.i;
        a.j = adj.j;
        const w = tileToWorld(adj.i, adj.j, grid.W, grid.H);
        const p = components.Position;
        p.x = w.x;
        p.y = grid.getElevation(adj.i, adj.j);
        p.z = w.z;
        any = true;
      }
      if (any && onRelocated) onRelocated();
    },
  };
}
