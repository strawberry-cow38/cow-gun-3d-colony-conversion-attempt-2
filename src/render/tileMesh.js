/**
 * Build a single BufferGeometry from a TileGrid.
 *
 * Each tile gets its own 4 vertices (no sharing) so per-tile biome color
 * has hard boundaries (rimworld-style) instead of blending at corners.
 * Two triangles per tile.
 *
 * For 200×200: 40k tiles × 4 verts = 160k verts, 80k triangles, single mesh,
 * one draw call.
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

/**
 * @param {import('../world/tileGrid.js').TileGrid} tileGrid
 */
export function buildTileMesh(tileGrid) {
  const { W, H } = tileGrid;
  const tileCount = W * H;
  const vertCount = tileCount * 4;
  const idxCount = tileCount * 6;

  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(idxCount);

  const halfW = (W * TILE_SIZE) / 2;
  const halfH = (H * TILE_SIZE) / 2;

  let v = 0;
  let ix = 0;
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
      const shade = 1 + Math.max(-0.25, Math.min(0.25, y / 60));
      const r = base.r * shade;
      const g = base.g * shade;
      const b = base.b * shade;
      for (let k = 0; k < 4; k++) {
        const o = (baseV + k) * 3;
        colors[o] = r;
        colors[o + 1] = g;
        colors[o + 2] = b;
      }

      // Counter-clockwise winding when viewed from above (+Y) so normals
      // face up and the mesh is visible from the camera, not just from below.
      indices[ix++] = baseV;
      indices[ix++] = baseV + 2;
      indices[ix++] = baseV + 1;
      indices[ix++] = baseV;
      indices[ix++] = baseV + 3;
      indices[ix++] = baseV + 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
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
