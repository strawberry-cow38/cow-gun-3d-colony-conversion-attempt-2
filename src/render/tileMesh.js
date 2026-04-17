/**
 * Build a single BufferGeometry from a TileGrid.
 *
 * Each tile gets its own 4 top vertices (no sharing) so per-tile biome color
 * has hard boundaries (rimworld-style) instead of blending at corners. For
 * every tile edge whose cross-grid neighbor sits lower (or is out of bounds),
 * a vertical cliff quad is emitted dropping from the tile's top Y down to the
 * neighbor's top (or 0 at the boundary). That keeps the stepped heightmap
 * visually solid — no void behind the cliff.
 */

import * as THREE from 'three';
import { TILE_SIZE } from '../world/coords.js';
import { BIOME } from '../world/tileGrid.js';

const BIOME_COLORS = {
  [BIOME.GRASS]: new THREE.Color(0x3a7a3a),
  [BIOME.DIRT]: new THREE.Color(0x6b4f2a),
  [BIOME.STONE]: new THREE.Color(0x6a6e74),
  [BIOME.SAND]: new THREE.Color(0xc8b27a),
  [BIOME.SHALLOW_WATER]: new THREE.Color(0x5aa0c8),
  [BIOME.DEEP_WATER]: new THREE.Color(0x2a5a8c),
};

// Cliff faces show exposed earth rather than the top-biome color — grass tiles
// shouldn't have green vertical walls. Darken the top color as a proxy for
// "subsurface rock/dirt" until we have a dedicated side material.
const CLIFF_SHADE = 0.55;

/**
 * @param {import('../world/tileGrid.js').TileGrid} tileGrid
 */
export function buildTileMesh(tileGrid) {
  const { W, H } = tileGrid;
  const tileCount = W * H;
  // Worst case: every tile has 4 neighbors lower than itself → 4 cliff quads.
  // Allocate the upper bound, slice at the end. Sub-typed arrays would be
  // equivalent but this keeps the hot loop branch-free on `push`.
  const maxVerts = tileCount * (4 + 4 * 4);
  const maxIdx = tileCount * (6 + 4 * 6);

  const positions = new Float32Array(maxVerts * 3);
  const colors = new Float32Array(maxVerts * 3);
  const indices = new Uint32Array(maxIdx);

  const halfW = (W * TILE_SIZE) / 2;
  const halfH = (H * TILE_SIZE) / 2;

  let v = 0;
  let ix = 0;

  /**
   * Emit a vertical cliff quad along one edge of the tile.
   * Vertex order: upper-left, upper-right, lower-right, lower-left, where
   * "upper" is at `topY` and "lower" at `bottomY`. Caller picks corners so
   * the outward-facing normal is correct for the edge.
   */
  const pushCliff = (ax, az, bx, bz, topY, bottomY, r, g, b) => {
    const baseV = v / 3;
    positions[v++] = ax;
    positions[v++] = topY;
    positions[v++] = az;
    positions[v++] = bx;
    positions[v++] = topY;
    positions[v++] = bz;
    positions[v++] = bx;
    positions[v++] = bottomY;
    positions[v++] = bz;
    positions[v++] = ax;
    positions[v++] = bottomY;
    positions[v++] = az;
    for (let k = 0; k < 4; k++) {
      const o = (baseV + k) * 3;
      colors[o] = r;
      colors[o + 1] = g;
      colors[o + 2] = b;
    }
    indices[ix++] = baseV;
    indices[ix++] = baseV + 1;
    indices[ix++] = baseV + 2;
    indices[ix++] = baseV;
    indices[ix++] = baseV + 2;
    indices[ix++] = baseV + 3;
  };

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x0 = i * TILE_SIZE - halfW;
      const x1 = x0 + TILE_SIZE;
      const z0 = j * TILE_SIZE - halfH;
      const z1 = z0 + TILE_SIZE;
      const y = tileGrid.getElevation(i, j);

      const baseV = v / 3;
      positions[v++] = x0;
      positions[v++] = y;
      positions[v++] = z0;
      positions[v++] = x1;
      positions[v++] = y;
      positions[v++] = z0;
      positions[v++] = x1;
      positions[v++] = y;
      positions[v++] = z1;
      positions[v++] = x0;
      positions[v++] = y;
      positions[v++] = z1;

      const biome = tileGrid.getBiome(i, j);
      const base = BIOME_COLORS[biome] || BIOME_COLORS[BIOME.GRASS];
      const topShade = 1 + Math.max(-0.25, Math.min(0.25, y / 60));
      const tr = base.r * topShade;
      const tg = base.g * topShade;
      const tb = base.b * topShade;
      for (let k = 0; k < 4; k++) {
        const o = (baseV + k) * 3;
        colors[o] = tr;
        colors[o + 1] = tg;
        colors[o + 2] = tb;
      }

      // Counter-clockwise winding when viewed from above (+Y) so normals
      // face up and the mesh is visible from the camera, not just from below.
      indices[ix++] = baseV;
      indices[ix++] = baseV + 2;
      indices[ix++] = baseV + 1;
      indices[ix++] = baseV;
      indices[ix++] = baseV + 3;
      indices[ix++] = baseV + 2;

      // Out-of-bounds neighbors drop to Y=0 (the water plane). Same-or-higher
      // neighbors get skipped — their own face will cover it when rendered.
      const cr = base.r * CLIFF_SHADE;
      const cg = base.g * CLIFF_SHADE;
      const cb = base.b * CLIFF_SHADE;
      const yW = i > 0 ? tileGrid.getElevation(i - 1, j) : 0;
      const yE = i < W - 1 ? tileGrid.getElevation(i + 1, j) : 0;
      const yN = j > 0 ? tileGrid.getElevation(i, j - 1) : 0;
      const yS = j < H - 1 ? tileGrid.getElevation(i, j + 1) : 0;
      // West edge: outward normal is -X. Winding so the lower-corner triangle
      // pair faces outward: (x0,z1,y) → (x0,z0,y) → down, then back.
      if (yW < y) pushCliff(x0, z1, x0, z0, y, yW, cr, cg, cb);
      // East edge: outward normal +X.
      if (yE < y) pushCliff(x1, z0, x1, z1, y, yE, cr, cg, cb);
      // North edge (-Z): outward normal -Z.
      if (yN < y) pushCliff(x0, z0, x1, z0, y, yN, cr, cg, cb);
      // South edge (+Z): outward normal +Z.
      if (yS < y) pushCliff(x1, z1, x0, z1, y, yS, cr, cg, cb);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, v), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, v), 3));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, ix), 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0,
    roughness: 1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
