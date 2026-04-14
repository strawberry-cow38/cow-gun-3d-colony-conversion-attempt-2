/**
 * Tree lifecycle: initial scatter, long-tier growth, and long-tier sapling
 * auto-spawn so chopped trees refill the map over time. Saplings only land
 * on grass/dirt that's clear of the player's build footprint.
 */

import { TIER_PERIODS } from '../ecs/schedule.js';
import { tileToWorld, worldToTileClamp } from '../world/coords.js';
import { BIOME } from '../world/tileGrid.js';
import { TREE_GROWTH_TICKS, randomTreeKind } from '../world/trees.js';

/** How many trees the initial-scatter produces per boot-param unit. */
const TREE_DENSITY_MULT = 6;

/**
 * Target tree count as a fraction of the grid area (grass+dirt only
 * conceptually, but we use total area as a cheap cap). Matches ~1% of tiles
 * at DEFAULT_GRID_W*H = 40k tiles so the map stays visibly wooded without
 * carpeting it.
 */
const SAPLING_TARGET_FRACTION = 0.01 * TREE_DENSITY_MULT;

/** Per run, attempt to place at most this many saplings. Keeps the long-tier
 * system O(1) per tick even on an empty map. */
const SAPLING_SPAWN_PER_RUN = 3;

/** Saplings must be at least this many tiles from any wall/door/torch/floor/
 * roof/stockpile/farmzone/tilled tile so they never sprout on top of a
 * colony. Radius 2 ≈ a 5×5 neighborhood. */
const SAPLING_SAFE_RADIUS = 2;

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i
 * @param {number} j
 * @param {{ kind?: string, growth?: number }} [opts]
 */
function spawnTree(world, grid, i, j, opts = {}) {
  if (!grid.inBounds(i, j) || grid.isBlocked(i, j)) return -1;
  grid.blockTile(i, j);
  const w = tileToWorld(i, j, grid.W, grid.H);
  const y = grid.getElevation(i, j);
  const kind = opts.kind ?? 'oak';
  const growth = Math.max(0, Math.min(1, opts.growth ?? 1));
  return world.spawn({
    Tree: { markedJobId: 0, progress: 0, kind, growth },
    TreeViz: {},
    TileAnchor: { i, j },
    Position: { x: w.x, y, z: w.z },
  });
}

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i
 * @param {number} j
 */
function isTreeBiome(grid, i, j) {
  const b = grid.biome[grid.idx(i, j)];
  return b === BIOME.GRASS || b === BIOME.DIRT;
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} count  boot param; scaled internally by TREE_DENSITY_MULT
 */
export function spawnInitialTrees(world, grid, count) {
  const target = Math.max(0, Math.floor(count * TREE_DENSITY_MULT));
  let placed = 0;
  let attempts = 0;
  const maxAttempts = target * 12;
  while (placed < target && attempts < maxAttempts) {
    attempts++;
    const i = Math.floor(Math.random() * grid.W);
    const j = Math.floor(Math.random() * grid.H);
    if (!isTreeBiome(grid, i, j)) continue;
    const kind = randomTreeKind();
    // Mix of growth stages so the map isn't uniformly-mature: uniform 0.1..1.
    const growth = 0.1 + 0.9 * Math.random();
    if (spawnTree(world, grid, i, j, { kind, growth }) !== -1) placed++;
  }
  return placed;
}

/**
 * @param {{ onGrowthChange: () => void }} deps
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeTreeGrowthSystem({ onGrowthChange }) {
  return {
    name: 'treeGrowth',
    tier: 'long',
    run(world) {
      let changed = false;
      for (const { components } of world.query(['Tree'])) {
        const tree = components.Tree;
        if (tree.growth >= 1) continue;
        const total = TREE_GROWTH_TICKS[tree.kind] ?? 0;
        if (total <= 0) continue;
        const next = Math.min(1, tree.growth + TIER_PERIODS.long / total);
        if (next !== tree.growth) {
          tree.growth = next;
          changed = true;
        }
      }
      if (changed) onGrowthChange();
    },
  };
}

/**
 * @param {{ grid: import('../world/tileGrid.js').TileGrid, onSpawn: () => void }} deps
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeSaplingSpawnSystem({ grid, onSpawn }) {
  return {
    name: 'saplingSpawn',
    tier: 'long',
    run(world) {
      const targetTrees = Math.floor(grid.W * grid.H * SAPLING_TARGET_FRACTION);
      let current = 0;
      for (const _ of world.query(['Tree'])) current++;
      if (current >= targetTrees) return;
      // Cows don't mark tile occupancy, so a blindly-placed sapling can block
      // the tile a cow is standing on — then every pathfind bails at the
      // start-walkable gate and the cow looks catatonic. Collect cow tiles
      // up-front and skip them.
      const cowTiles = new Set();
      for (const { components } of world.query(['Cow', 'Position'])) {
        const p = components.Position;
        const t = worldToTileClamp(p.x, p.z, grid.W, grid.H);
        cowTiles.add(t.j * grid.W + t.i);
      }
      let placed = 0;
      let attempts = 0;
      const maxAttempts = SAPLING_SPAWN_PER_RUN * 16;
      while (placed < SAPLING_SPAWN_PER_RUN && attempts < maxAttempts) {
        attempts++;
        const i = Math.floor(Math.random() * grid.W);
        const j = Math.floor(Math.random() * grid.H);
        if (!isTreeBiome(grid, i, j)) continue;
        if (grid.isBlocked(i, j)) continue;
        if (cowTiles.has(j * grid.W + i)) continue;
        if (nearColonyFootprint(grid, i, j, SAPLING_SAFE_RADIUS)) continue;
        const kind = randomTreeKind();
        if (spawnTree(world, grid, i, j, { kind, growth: 0 }) !== -1) placed++;
      }
      if (placed > 0) onSpawn();
    },
  };
}

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i
 * @param {number} j
 * @param {number} radius
 */
function nearColonyFootprint(grid, i, j, radius) {
  const i0 = Math.max(0, i - radius);
  const i1 = Math.min(grid.W - 1, i + radius);
  const j0 = Math.max(0, j - radius);
  const j1 = Math.min(grid.H - 1, j + radius);
  for (let jj = j0; jj <= j1; jj++) {
    for (let ii = i0; ii <= i1; ii++) {
      const k = grid.idx(ii, jj);
      if (
        grid.wall[k] !== 0 ||
        grid.door[k] !== 0 ||
        grid.torch[k] !== 0 ||
        grid.roof[k] !== 0 ||
        grid.floor[k] !== 0 ||
        grid.stockpile[k] !== 0 ||
        grid.farmZone[k] !== 0 ||
        grid.tilled[k] !== 0
      ) {
        return true;
      }
    }
  }
  return false;
}
