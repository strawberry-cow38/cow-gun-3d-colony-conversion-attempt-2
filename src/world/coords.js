/**
 * World coordinate system constants and helpers.
 *
 * Locked per ARCHITECTURE.md §6:
 * - 1 unit = 3.5 cm
 * - 1 tile = 1.5 m = 43 units
 * - Three.js convention: Y is up, right-handed coordinate system.
 *
 * Tile (i, j) center in world space:
 *   x = (i + 0.5) * TILE_SIZE  - (W * TILE_SIZE / 2)
 *   z = (j + 0.5) * TILE_SIZE  - (H * TILE_SIZE / 2)
 *   y = elevation(i, j)
 *
 * The grid is centered on the world origin so the camera default looks at (0, 0, 0).
 */

export const UNITS_PER_METER = 100 / 3.5;
export const TILE_METERS = 1.5;
export const TILE_SIZE = TILE_METERS * UNITS_PER_METER;
export const DEFAULT_GRID_W = 200;
export const DEFAULT_GRID_H = 200;

/**
 * Convert tile coords (i, j) to world-space (x, z) at the tile's center.
 * The grid is centered on the origin.
 *
 * @param {number} i
 * @param {number} j
 * @param {number} W
 * @param {number} H
 * @returns {{ x: number, z: number }}
 */
export function tileToWorld(i, j, W, H) {
  return {
    x: (i + 0.5 - W / 2) * TILE_SIZE,
    z: (j + 0.5 - H / 2) * TILE_SIZE,
  };
}

/**
 * Convert world-space (x, z) to tile coords (i, j). Out-of-grid coords
 * return (-1, -1).
 *
 * @param {number} x
 * @param {number} z
 * @param {number} W
 * @param {number} H
 * @returns {{ i: number, j: number }}
 */
export function worldToTile(x, z, W, H) {
  const i = Math.floor(x / TILE_SIZE + W / 2);
  const j = Math.floor(z / TILE_SIZE + H / 2);
  if (i < 0 || j < 0 || i >= W || j >= H) return { i: -1, j: -1 };
  return { i, j };
}
