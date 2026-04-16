/**
 * Shared orientation test used by both the finished-door renderer and the
 * blueprint ghost renderer. Reads the live wall bitmap on each side of a
 * door tile: if only the N/S neighbours are walls, the slab needs to rotate
 * 90° so it blocks the corridor the player drew. Mixed / all-sides runs
 * default to the EW axis (baseAngle = 0).
 *
 * @param {import('./tileGrid.js').TileGrid} grid
 * @param {number} i
 * @param {number} j
 * @returns {{ wallsEW: boolean, wallsNS: boolean, rotateNS: boolean }}
 */
export function doorOrientationAt(grid, i, j) {
  const wallsEW = grid.isWall(i - 1, j) || grid.isWall(i + 1, j);
  const wallsNS = grid.isWall(i, j - 1) || grid.isWall(i, j + 1);
  return { wallsEW, wallsNS, rotateNS: wallsNS && !wallsEW };
}
