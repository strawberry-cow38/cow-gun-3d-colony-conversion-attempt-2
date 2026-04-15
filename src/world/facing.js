/**
 * Cardinal facing index used by directional placeables (furnaces today, more
 * later). 0 = south(+z), 1 = east(+x), 2 = north(-z), 3 = west(-x).
 *
 * Why store a 0..3 index and not (di, dj)? It's compact in components and
 * easy to cycle with R during placement. Renderers and pathing read these
 * lookup tables instead of recomputing the trig.
 */

export const FACING_OFFSETS = [
  { di: 0, dj: 1 },
  { di: 1, dj: 0 },
  { di: 0, dj: -1 },
  { di: -1, dj: 0 },
];

export const FACING_YAWS = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2];

/**
 * Perpendicular step along a wall span for a given facing — size>1 wall art
 * (and any future placeable that spans multiple wall tiles) extends in this
 * direction. Facing south/north (visible from ±z) walks east-west; facing
 * east/west (visible from ±x) walks north-south.
 */
export const FACING_SPAN_OFFSETS = [
  { di: 1, dj: 0 },
  { di: 0, dj: 1 },
  { di: -1, dj: 0 },
  { di: 0, dj: -1 },
];
