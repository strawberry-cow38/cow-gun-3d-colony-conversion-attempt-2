/**
 * Bed is a 2×1 structure: anchor tile + one tile extending forward along
 * `facing`. Cows can enter from any side and claim ownership on first sleep
 * (future phase 3). Both tiles stay walkable — cows need to path onto the
 * mattress to lie down.
 */

import { FACING_OFFSETS } from './facing.js';

export const BED_SPAN = 2;

/**
 * Two tiles the bed occupies: anchor + one forward step.
 *
 * @param {{ i: number, j: number }} anchor
 * @param {number} facing
 * @returns {{ i: number, j: number }[]}
 */
export function bedFootprintTiles(anchor, facing) {
  const off = FACING_OFFSETS[facing] ?? FACING_OFFSETS[0];
  return [
    { i: anchor.i, j: anchor.j },
    { i: anchor.i + off.di, j: anchor.j + off.dj },
  ];
}
