/**
 * Stair is a 5-tile structure that connects layer z with layer z+1:
 *
 *   [bottom landing] [ramp] [ramp] [ramp] [top landing]
 *        anchor   →→→→ forward along facing →→→→  end
 *
 * `facing` (FACING_OFFSETS) points from anchor toward the top. The anchor is
 * the bottom landing — it stays flush with the ground layer. The three middle
 * tiles carry a ramp bit on the bottom layer; pathfinding treats a ramp at
 * (i,j,z) as a lift to (i,j,z+1). The top landing tile gets a floor bit on
 * z+1 so cows have solid footing when stepping off the last ramp.
 */

import { FACING_OFFSETS } from './facing.js';

export const STAIR_LENGTH = 5;

/**
 * All 5 tiles in walk order (bottom landing → top landing).
 *
 * @param {{ i: number, j: number }} anchor
 * @param {number} facing
 * @returns {{ i: number, j: number }[]}
 */
export function stairFootprintTiles(anchor, facing) {
  const off = FACING_OFFSETS[facing] ?? FACING_OFFSETS[0];
  const out = [];
  for (let n = 0; n < STAIR_LENGTH; n++) {
    out.push({ i: anchor.i + off.di * n, j: anchor.j + off.dj * n });
  }
  return out;
}

/**
 * Just the 3 middle tiles — these get ramp bits on the bottom layer.
 *
 * @param {{ i: number, j: number }} anchor
 * @param {number} facing
 * @returns {{ i: number, j: number }[]}
 */
export function stairRampTiles(anchor, facing) {
  return stairFootprintTiles(anchor, facing).slice(1, 4);
}

/**
 * The top landing tile — gets a floor bit on layer z+1.
 *
 * @param {{ i: number, j: number }} anchor
 * @param {number} facing
 */
export function stairTopLandingTile(anchor, facing) {
  const fp = stairFootprintTiles(anchor, facing);
  return fp[fp.length - 1];
}
