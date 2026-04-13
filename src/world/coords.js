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
 * return (-1, -1). A click exactly on the positive edge lands on the last
 * tile rather than falling off the grid.
 *
 * @param {number} x
 * @param {number} z
 * @param {number} W
 * @param {number} H
 * @returns {{ i: number, j: number }}
 */
export function worldToTile(x, z, W, H) {
  let i = Math.floor(x / TILE_SIZE + W / 2);
  let j = Math.floor(z / TILE_SIZE + H / 2);
  if (i === W) i = W - 1;
  if (j === H) j = H - 1;
  if (i < 0 || j < 0 || i >= W || j >= H) return { i: -1, j: -1 };
  return { i, j };
}

/**
 * Clamped world-to-tile: always returns an in-bounds tile, pinning
 * out-of-grid coords to the nearest edge. Use when a cow or target may
 * briefly drift off the grid and we still want a usable tile index.
 *
 * @param {number} x @param {number} z @param {number} W @param {number} H
 * @returns {{ i: number, j: number }}
 */
export function worldToTileClamp(x, z, W, H) {
  const i = Math.floor(x / TILE_SIZE + W / 2);
  const j = Math.floor(z / TILE_SIZE + H / 2);
  return { i: Math.max(0, Math.min(W - 1, i)), j: Math.max(0, Math.min(H - 1, j)) };
}
