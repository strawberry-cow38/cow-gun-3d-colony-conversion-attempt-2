/**
 * Auto-roof queueing. After the rooms registry rebuilds, walk every enclosed
 * room's interior tiles and post a roof BuildSite for any tile that:
 *   - has no roof bit set,
 *   - has no `ignoreRoof` designation,
 *   - doesn't already have a roof BuildSite pending,
 *   - sits within ROOF_MAX_WALL_DISTANCE Chebyshev of a wall.
 *
 * Roofs cost no resources (required=0), so the haul poster immediately
 * promotes the site to a build job on the next rare tick.
 *
 * Called from the rooms system's `onRebuilt` callback — runs exactly when
 * topology actually changed.
 */

import { ROOF_MAX_WALL_DISTANCE, wallWithinChebyshev } from '../render/buildDesignator.js';
import { tileToWorld } from '../world/coords.js';

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {import('../jobs/board.js').JobBoard} _board  kept for future use
 * @param {import('./rooms.js').RoomRegistry} rooms
 */
export function runAutoRoof(world, grid, _board, rooms) {
  const pending = new Set();
  for (const { components } of world.query(['BuildSite', 'TileAnchor'])) {
    if (components.BuildSite.kind !== 'roof') continue;
    const a = components.TileAnchor;
    pending.add(a.j * grid.W + a.i);
  }

  for (const room of rooms.rooms.values()) {
    for (const tileIdx of room.tiles) {
      if (grid.roof[tileIdx] !== 0) continue;
      if (grid.ignoreRoof[tileIdx] !== 0) continue;
      if (pending.has(tileIdx)) continue;
      const i = tileIdx % grid.W;
      const j = (tileIdx - i) / grid.W;
      if (!wallWithinChebyshev(grid, i, j, ROOF_MAX_WALL_DISTANCE)) continue;
      const w = tileToWorld(i, j, grid.W, grid.H);
      world.spawn({
        BuildSite: {
          kind: 'roof',
          requiredKind: 'wood',
          required: 0,
          delivered: 0,
          buildJobId: 0,
          progress: 0,
        },
        BuildSiteViz: {},
        TileAnchor: { i, j },
        Position: { x: w.x, y: grid.getElevation(i, j), z: w.z },
      });
      pending.add(tileIdx);
    }
  }
}
