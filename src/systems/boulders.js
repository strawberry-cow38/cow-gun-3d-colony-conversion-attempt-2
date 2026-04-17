/**
 * Boulder world-gen. Static nodes scattered on gen, never respawned. Each
 * kind biases toward STONE biome but falls back to GRASS/DIRT if STONE is
 * saturated so the attempt loop doesn't spin forever on stone-light maps.
 */

import { BOULDER_KINDS } from '../world/boulders.js';
import { tileToWorld } from '../world/coords.js';
import { BIOME } from '../world/tileGrid.js';

/**
 * Per-kind count = boot-param tree count × multiplier. Trees themselves
 * multiply by 6 (see trees.js TREE_DENSITY_MULT), so:
 *   stone = 2× tree pop = 12× boot param
 *   coal  = 2/3× tree pop = 4× boot param
 *   copper = 1/2× tree pop = 3× boot param
 */
const BOULDER_DENSITY_MULT = {
  stone: 12,
  coal: 4,
  copper: 3,
};

const STONE_ATTEMPT_BUDGET = 12;
const FALLBACK_ATTEMPT_BUDGET = 6;

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {string} kind
 * @param {number} i
 * @param {number} j
 */
function spawnBoulder(world, grid, kind, i, j) {
  if (!grid.inBounds(i, j) || grid.isBlocked(i, j)) return -1;
  grid.blockTile(i, j);
  const w = tileToWorld(i, j, grid.W, grid.H);
  const y = grid.getElevation(i, j);
  return world.spawn({
    Boulder: { markedJobId: 0, progress: 0, kind },
    BoulderViz: {},
    TileAnchor: { i, j },
    Position: { x: w.x, y, z: w.z },
  });
}

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i
 * @param {number} j
 * @param {boolean} requireStone
 */
function isBoulderTile(grid, i, j, requireStone) {
  const b = grid.biome[grid.idx(i, j)];
  if (requireStone) return b === BIOME.STONE;
  return b === BIOME.GRASS || b === BIOME.DIRT || b === BIOME.STONE;
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} count  boot param (same one trees use)
 */
export function spawnInitialBoulders(world, grid, count) {
  let total = 0;
  for (const kind of BOULDER_KINDS) {
    const target = Math.max(0, Math.floor(count * (BOULDER_DENSITY_MULT[kind] ?? 0)));
    total += placeKind(world, grid, kind, target);
  }
  return total;
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {string} kind
 * @param {number} target
 */
function placeKind(world, grid, kind, target) {
  let placed = 0;
  let attempts = 0;
  const stoneAttempts = target * STONE_ATTEMPT_BUDGET;
  while (placed < target && attempts < stoneAttempts) {
    attempts++;
    const i = Math.floor(Math.random() * grid.W);
    const j = Math.floor(Math.random() * grid.H);
    if (!isBoulderTile(grid, i, j, true)) continue;
    if (spawnBoulder(world, grid, kind, i, j) !== -1) placed++;
  }
  if (placed >= target) return placed;
  const fallbackAttempts = target * FALLBACK_ATTEMPT_BUDGET;
  attempts = 0;
  while (placed < target && attempts < fallbackAttempts) {
    attempts++;
    const i = Math.floor(Math.random() * grid.W);
    const j = Math.floor(Math.random() * grid.H);
    if (!isBoulderTile(grid, i, j, false)) continue;
    if (spawnBoulder(world, grid, kind, i, j) !== -1) placed++;
  }
  return placed;
}
