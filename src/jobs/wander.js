/**
 * Wander behavior: pick a random walkable tile, walk there, idle a moment, repeat.
 *
 * This is the cow's *fallback* — it isn't posted on the JobBoard. The cow brain
 * synthesizes a wander goal whenever no real job is claimable. Real jobs (chop,
 * haul, etc.) will arrive via JobBoard in Phase 4.
 *
 * State machine on Job.payload:
 *   { stage: 'planning' }              → pick goal, request path, → 'moving'
 *   { stage: 'moving',  goal }         → follow Path component, → 'idle' on arrival
 *   { stage: 'idle',    untilTick }    → wait, → 'planning' when tick passes
 */

import { TileGrid } from '../world/tileGrid.js';

const IDLE_TICKS = 60; // 2 seconds at 30 Hz

export const WANDER_RADIUS_TILES = 20;

/**
 * Pick a random walkable tile. When `center` is provided, the pick is
 * constrained to a Chebyshev-square of `radius` tiles around it so cows
 * don't trek across the whole map on a single wander. Tries up to
 * `attempts` times before giving up.
 *
 * @param {TileGrid} grid
 * @param {(grid: TileGrid, i: number, j: number) => boolean} walkable
 * @param {{ i: number, j: number } | null} [center]
 * @param {number} [radius]
 * @param {() => number} [rand]
 * @param {number} [attempts]
 */
export function pickRandomWalkable(
  grid,
  walkable,
  center = null,
  radius = WANDER_RADIUS_TILES,
  rand = Math.random,
  attempts = 32,
) {
  for (let n = 0; n < attempts; n++) {
    let i;
    let j;
    if (center) {
      i = center.i + Math.floor(rand() * (radius * 2 + 1)) - radius;
      j = center.j + Math.floor(rand() * (radius * 2 + 1)) - radius;
      if (i < 0 || j < 0 || i >= grid.W || j >= grid.H) continue;
      if (i === center.i && j === center.j) continue;
    } else {
      i = Math.floor(rand() * grid.W);
      j = Math.floor(rand() * grid.H);
    }
    if (walkable(grid, i, j)) return { i, j };
  }
  return null;
}

export const WANDER_IDLE_TICKS = IDLE_TICKS;
