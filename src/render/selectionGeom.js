/**
 * Shared vertex writers for selection/overlay line geometries. Several
 * overlays (item stacks, furnaces, future building types) draw the same
 * axis-aligned square footprint outline — keep the vertex layout in one
 * place so the edge order stays consistent and any pool-capacity callers
 * don't drift.
 */

/**
 * Writes 8 line vertices (4 segments: N, E, S, W) forming an axis-aligned
 * rectangle outline at (x, z) on plane y, with half-extents rx and rz.
 *
 * @param {Float32Array} out
 * @param {number} off
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} rx
 * @param {number} rz
 */
export function writeRectOutline(out, off, x, y, z, rx, rz) {
  const x0 = x - rx;
  const x1 = x + rx;
  const z0 = z - rz;
  const z1 = z + rz;
  let p = off;
  // N edge
  out[p++] = x0;
  out[p++] = y;
  out[p++] = z0;
  out[p++] = x1;
  out[p++] = y;
  out[p++] = z0;
  // E edge
  out[p++] = x1;
  out[p++] = y;
  out[p++] = z0;
  out[p++] = x1;
  out[p++] = y;
  out[p++] = z1;
  // S edge
  out[p++] = x1;
  out[p++] = y;
  out[p++] = z1;
  out[p++] = x0;
  out[p++] = y;
  out[p++] = z1;
  // W edge
  out[p++] = x0;
  out[p++] = y;
  out[p++] = z1;
  out[p++] = x0;
  out[p++] = y;
  out[p++] = z0;
}

/**
 * Writes 8 line vertices for a square outline — thin wrapper around
 * writeRectOutline with equal half-extents.
 *
 * @param {Float32Array} out
 * @param {number} off
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} r
 */
export function writeSquareOutline(out, off, x, y, z, r) {
  writeRectOutline(out, off, x, y, z, r, r);
}
