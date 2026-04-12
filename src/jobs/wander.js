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

/**
 * Pick a random walkable tile. Tries up to `attempts` times before giving up.
 * @param {TileGrid} grid
 * @param {(grid: TileGrid, i: number, j: number) => boolean} walkable
 * @param {() => number} rand
 * @param {number} attempts
 */
export function pickRandomWalkable(grid, walkable, rand = Math.random, attempts = 32) {
  for (let n = 0; n < attempts; n++) {
    const i = Math.floor(rand() * grid.W);
    const j = Math.floor(rand() * grid.H);
    if (walkable(grid, i, j)) return { i, j };
  }
  return null;
}

export const WANDER_IDLE_TICKS = IDLE_TICKS;
