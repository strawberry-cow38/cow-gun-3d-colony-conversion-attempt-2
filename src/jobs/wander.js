/**
 * Wander behavior: pick a random walkable tile, walk there, idle a moment, repeat.
 *
 * Wander is the cow's *fallback* — it isn't posted on the JobBoard. The cow
 * brain synthesizes a wander goal whenever no real job is claimable.
 *
 * State machine on Job.payload:
 *   { stage: 'planning' }              → pick goal, request path, → 'moving'
 *   { stage: 'moving',  goal }         → follow Path component, → 'idle' on arrival
 *   { stage: 'idle',    untilTick }    → wait, → 'planning' when tick passes
 */

import { BIOME, TileGrid } from '../world/tileGrid.js';

const IDLE_TICKS = 60; // 2 seconds at 30 Hz

/** Cows only wander within this Chebyshev radius of the colony — close
 * enough to remain on-call for jobs, far enough that wander feels alive. */
const WANDER_RADIUS_TILES = 20;

/**
 * Pick a random walkable, non-water tile inside a 20-tile Chebyshev square
 * around a colony anchor. The anchor is a random player structure tile if
 * any exist; otherwise we fall back to the map center so fresh worlds don't
 * send cows hiking off to the corner on turn one. Tries `attempts` times
 * before giving up.
 *
 * Water tiles are rejected outright: shallow water is walkable (cows wade
 * through it) but makes a bad hang-out target, and deep water is unwalkable.
 *
 * @param {TileGrid} grid
 * @param {(grid: TileGrid, i: number, j: number) => boolean} walkable
 * @param {() => number} [rand]
 * @param {number} [attempts]
 */
export function pickWanderGoal(grid, walkable, rand = Math.random, attempts = 32) {
  const center = pickAnchor(grid, rand);
  const radius = WANDER_RADIUS_TILES;
  for (let n = 0; n < attempts; n++) {
    const i = center.i + Math.floor(rand() * (radius * 2 + 1)) - radius;
    const j = center.j + Math.floor(rand() * (radius * 2 + 1)) - radius;
    if (i < 0 || j < 0 || i >= grid.W || j >= grid.H) continue;
    if (i === center.i && j === center.j) continue;
    const k = grid.idx(i, j);
    const b = grid.biome[k];
    if (b === BIOME.SHALLOW_WATER || b === BIOME.DEEP_WATER) continue;
    if (!walkable(grid, i, j)) continue;
    return { i, j };
  }
  return null;
}

/**
 * Pick a random structure tile as the wander anchor, or fall back to the
 * map center when the colony hasn't placed anything yet.
 * @param {TileGrid} grid
 * @param {() => number} rand
 */
function pickAnchor(grid, rand) {
  const n = grid.structureTiles.size;
  if (n > 0) {
    let pick = Math.floor(rand() * n);
    for (const k of grid.structureTiles) {
      if (pick-- === 0) return { i: k % grid.W, j: Math.floor(k / grid.W) };
    }
  }
  return { i: Math.floor(grid.W / 2), j: Math.floor(grid.H / 2) };
}

export const WANDER_IDLE_TICKS = IDLE_TICKS;
