/**
 * Read URL params that tune the initial world. Each returned field has a
 * documented default so the game boots fine with no querystring.
 */

import { DEFAULT_GRID_H, DEFAULT_GRID_W } from '../world/coords.js';

/**
 * @typedef BootParams
 * @property {number} stressCount  ?stress=N spawns N bouncing boxes for perf stress
 * @property {number} cowCount     ?cows=N cows at spawn (default 10)
 * @property {number} treeCount    ?trees=N trees scattered on the map (default 60)
 * @property {number} gridW        ?w=N tile grid width
 * @property {number} gridH        ?h=N tile grid height
 */

/** @returns {BootParams} */
export function readBootParams() {
  const p = new URLSearchParams(location.search);
  return {
    stressCount: Number.parseInt(p.get('stress') ?? '0', 10),
    cowCount: Number.parseInt(p.get('cows') ?? '10', 10),
    treeCount: Number.parseInt(p.get('trees') ?? '60', 10),
    gridW: Number.parseInt(p.get('w') ?? `${DEFAULT_GRID_W}`, 10),
    gridH: Number.parseInt(p.get('h') ?? `${DEFAULT_GRID_H}`, 10),
  };
}
