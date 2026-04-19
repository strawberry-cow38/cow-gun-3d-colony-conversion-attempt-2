/**
 * Bush world-gen. Pure decor billboards scattered on grass tiles at gen time.
 * Non-blocking (cows walk through — bushes are small + the real alpha cutout
 * is visual only), no jobs, no persistence. Re-spawn on every world load is
 * fine because load flow regenerates the world when no bush data is saved.
 */

import { tileToWorld } from '../world/coords.js';
import { BIOME } from '../world/tileGrid.js';

const ATTEMPT_BUDGET = 8;

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i
 * @param {number} j
 */
function spawnBush(world, grid, i, j) {
  if (!grid.inBounds(i, j) || grid.isBlocked(i, j)) return -1;
  if (grid.biome[grid.idx(i, j)] !== BIOME.GRASS) return -1;
  const w = tileToWorld(i, j, grid.W, grid.H);
  const y = grid.getElevation(i, j);
  const yaw = Math.random() * Math.PI * 2;
  const scale = 0.7 + Math.random() * 0.45;
  return world.spawn({
    Bush: {},
    BushViz: { yaw, scale },
    TileAnchor: { i, j },
    Position: { x: w.x, y, z: w.z },
  });
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} count boot param (same one trees use); bushes are ~3× that
 */
export function spawnInitialBushes(world, grid, count) {
  const target = Math.max(0, Math.floor(count * 3));
  let placed = 0;
  let attempts = 0;
  const budget = target * ATTEMPT_BUDGET;
  while (placed < target && attempts < budget) {
    attempts++;
    const i = Math.floor(Math.random() * grid.W);
    const j = Math.floor(Math.random() * grid.H);
    if (spawnBush(world, grid, i, j) !== -1) placed++;
  }
  return placed;
}
