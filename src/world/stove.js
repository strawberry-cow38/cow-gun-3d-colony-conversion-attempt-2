/**
 * Stove is a 3x1 structure: anchor tile sits in the middle, two side tiles
 * extend perpendicular to its facing. All three tiles are blocked. The
 * long side facing the work-spot presents a single interaction point.
 *
 * `facing` indexes FACING_OFFSETS — the tile in front of the anchor along
 * that offset is the work spot. The perpendicular axis (FACING_SPAN_OFFSETS)
 * is the span the stove body occupies.
 */

import { FACING_SPAN_OFFSETS } from './facing.js';

export const STOVE_SPAN = 3;

/**
 * Three tiles the stove body occupies: the anchor and its two span-neighbors.
 *
 * @param {{ i: number, j: number }} anchor
 * @param {number} facing
 * @returns {{ i: number, j: number }[]}
 */
export function stoveFootprintTiles(anchor, facing) {
  const off = FACING_SPAN_OFFSETS[facing] ?? FACING_SPAN_OFFSETS[0];
  return [
    { i: anchor.i - off.di, j: anchor.j - off.dj },
    { i: anchor.i, j: anchor.j },
    { i: anchor.i + off.di, j: anchor.j + off.dj },
  ];
}
