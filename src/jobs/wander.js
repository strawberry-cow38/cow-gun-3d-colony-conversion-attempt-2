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
 * When `from` is supplied, candidates separated from the cow by water are
 * also rejected (straight-line check) — pathfinder will happily route a
 * wandering cow through a shallow river because wade-crossing is legal, so
 * without this filter idle colonists swim back and forth across rivers.
 *
 * @param {TileGrid} grid
 * @param {(grid: TileGrid, i: number, j: number) => boolean} walkable
 * @param {{ i: number, j: number } | null} [from]
 * @param {() => number} [rand]
 * @param {number} [attempts]
 */
export function pickWanderGoal(grid, walkable, from = null, rand = Math.random, attempts = 32) {
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
    if (from && lineCrossesWater(grid, from.i, from.j, i, j)) continue;
    return { i, j };
  }
  return null;
}

/**
 * Bresenham-sampled check: true if any tile on the straight line from
 * (x0,y0) to (x1,y1) is shallow or deep water. Cheap enough to run per
 * wander candidate (~20 tiles/line), and catches the "opposite bank of
 * a river" case without needing flood-fill components.
 * @param {TileGrid} grid
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 */
function lineCrossesWater(grid, x0, y0, x1, y1) {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    const b = grid.biome[grid.idx(x, y)];
    if (b === BIOME.SHALLOW_WATER || b === BIOME.DEEP_WATER) return true;
    if (x === x1 && y === y1) return false;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
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
