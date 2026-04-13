/**
 * Tree lifecycle:
 *   - `spawnInitialTrees` scatters trees at random walkable tiles on startup,
 *     marking their tiles occupied.
 *   - `spawnTree` / `despawnTree` keep the grid occupancy in sync and tell the
 *     path cache to invalidate (walkability just changed).
 *
 * Helpers are imperative — the renderer reads entity state each frame so there
 * is no per-tick tree system to run.
 */

import { tileToWorld } from '../world/coords.js';

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i
 * @param {number} j
 * @returns {number} entity id, or -1 if tile was already blocked
 */
export function spawnTree(world, grid, i, j) {
  if (!grid.inBounds(i, j) || grid.isBlocked(i, j)) return -1;
  grid.blockTile(i, j);
  const w = tileToWorld(i, j, grid.W, grid.H);
  const y = grid.getElevation(i, j);
  return world.spawn({
    Tree: {},
    TreeViz: {},
    TileAnchor: { i, j },
    Position: { x: w.x, y, z: w.z },
  });
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} entityId
 */
export function despawnTree(world, grid, entityId) {
  const anchor = world.get(entityId, 'TileAnchor');
  if (anchor) grid.unblockTile(anchor.i, anchor.j);
  world.despawn(entityId);
}

/**
 * Scatter `count` trees across walkable tiles. Skips tiles already blocked
 * (e.g. cows' spawn tiles). Uses Math.random — for determinism pass a seeded
 * RNG later.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} count
 */
export function spawnInitialTrees(world, grid, count) {
  let placed = 0;
  let attempts = 0;
  const maxAttempts = count * 8;
  while (placed < count && attempts < maxAttempts) {
    attempts++;
    const i = Math.floor(Math.random() * grid.W);
    const j = Math.floor(Math.random() * grid.H);
    if (spawnTree(world, grid, i, j) !== -1) placed++;
  }
  return placed;
}
