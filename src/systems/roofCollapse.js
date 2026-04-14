/**
 * Roof collapse check. Delegates the "which roofs are still supported" BFS to
 * findSupportedRoofTiles; any Roof entity not in that set has lost its chain
 * to a wall/door (someone demolished the supporting wall) and is despawned.
 * Callers get back the world-space positions of the collapsed tiles so they
 * can spawn the dust burst + audio.
 *
 * Invoked from the rooms-rebuild callback — runs on the same topology dirty
 * pulse that fires for any wall/door build or deconstruct.
 */

import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { findSupportedRoofTiles } from './autoRoof.js';

// Roof sits on wall-top; must stay in sync with roofInstancer.WALL_HEIGHT.
// Declared here rather than imported because systems/ can't pull from render/.
const ROOF_Y = 3 * UNITS_PER_METER;

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {Array<{x: number, y: number, z: number}>}  positions of roofs that just collapsed
 */
export function runRoofCollapse(world, grid) {
  const supported = findSupportedRoofTiles(grid);
  /** @type {Array<{x: number, y: number, z: number}>} */
  const collapsed = [];
  /** @type {Array<{id: number, i: number, j: number}>} */
  const doomed = [];
  for (const { id, components } of world.query(['Roof', 'TileAnchor'])) {
    const { i, j } = components.TileAnchor;
    if (supported.has(grid.idx(i, j))) continue;
    doomed.push({ id, i, j });
  }
  for (const { id, i, j } of doomed) {
    grid.setRoof(i, j, 0);
    world.despawn(id);
    const w = tileToWorld(i, j, grid.W, grid.H);
    collapsed.push({ x: w.x, y: grid.getElevation(i, j) + ROOF_Y, z: w.z });
  }
  return collapsed;
}
