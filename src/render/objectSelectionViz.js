/**
 * Translucent ghost box around every entity in `state.selectedObjects`.
 * One InstancedMesh with a semi-transparent cube; per-type dimensions live
 * in BOX_DIMS so a tree-sized box fits a tree, a roof-sized box hugs the
 * roof tile, etc. Cheap: matrices only re-composed when the selection
 * signature changes frame-to-frame.
 */

import * as THREE from 'three';
import { objectTypeFor } from '../ui/objectTypes.js';
import { TILE_SIZE, tileToWorld } from '../world/coords.js';

const SELECT_COLOR = 0xffe14a;
const CAPACITY = 1024;

/**
 * Per-type ghost-box dimensions in tile units. `yBase` is the world-space
 * offset from the tile's ground elevation to the box's bottom face.
 *
 * @type {Record<string, { w: number, h: number, d: number, yBase: number }>}
 */
const BOX_DIMS = {
  tree: { w: 0.95, h: 2.8, d: 0.95, yBase: 0 },
  boulder: { w: 0.95, h: 0.7, d: 0.95, yBase: 0 },
  wall: { w: 1.0, h: 1.8, d: 1.0, yBase: 0 },
  door: { w: 1.0, h: 1.8, d: 1.0, yBase: 0 },
  torch: { w: 0.45, h: 1.1, d: 0.45, yBase: 0 },
  roof: { w: 1.0, h: 0.2, d: 1.0, yBase: 1.8 },
  floor: { w: 1.0, h: 0.12, d: 1.0, yBase: 0 },
};
const DEFAULT_DIMS = { w: 0.9, h: 1.5, d: 0.9, yBase: 0 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** @param {THREE.Scene} scene */
export function createObjectSelectionViz(scene) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: SELECT_COLOR,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 998;
  scene.add(mesh);

  // Edge overlay so the box still reads crisply from a distance where the
  // alpha fill washes out.
  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({
    color: SELECT_COLOR,
    transparent: true,
    opacity: 0.7,
    depthTest: false,
  });
  // Dedicated wireframe pool: instanced line segments aren't a standard
  // three primitive, so we keep a small reusable LineSegments and push
  // matrix-transformed positions manually each frame. Capacity matches the
  // fill mesh.
  const edgeBasePositions = /** @type {Float32Array} */ (edgeGeo.getAttribute('position').array);
  const edgeVertCount = edgeBasePositions.length / 3;
  const edgePositions = new Float32Array(CAPACITY * edgeVertCount * 3);
  const edgeBuffer = new THREE.BufferGeometry();
  edgeBuffer.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
  edgeBuffer.setDrawRange(0, 0);
  const edges = new THREE.LineSegments(edgeBuffer, edgeMat);
  edges.frustumCulled = false;
  edges.renderOrder = 999;
  scene.add(edges);

  let lastSig = '';

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {Set<number>} selected
   */
  function update(world, grid, selected) {
    let sig = `${selected.size}|`;
    for (const id of selected) sig += `${id},`;
    if (sig === lastSig) return;
    lastSig = sig;

    let n = 0;
    for (const id of selected) {
      if (n >= CAPACITY) break;
      const anchor = world.get(id, 'TileAnchor');
      if (!anchor) continue;
      const entry = objectTypeFor(world, id);
      const dims = (entry ? BOX_DIMS[entry.type] : null) ?? DEFAULT_DIMS;
      const w = dims.w * TILE_SIZE;
      const h = dims.h * TILE_SIZE;
      const d = dims.d * TILE_SIZE;
      const center = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j) + dims.yBase * TILE_SIZE + h * 0.5;
      _p.set(center.x, y, center.z);
      _q.identity();
      _s.set(w, h, d);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(n, _m);
      writeEdges(edgePositions, n * edgeVertCount * 3, edgeBasePositions, _m);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = n > 0;

    edgeBuffer.setDrawRange(0, n * edgeVertCount);
    edgeBuffer.attributes.position.needsUpdate = true;
    edges.visible = n > 0;
  }

  function markDirty() {
    lastSig = '';
  }

  return { update, markDirty };
}

/**
 * @param {Float32Array} out @param {number} off
 * @param {ArrayLike<number>} base @param {THREE.Matrix4} m
 */
function writeEdges(out, off, base, m) {
  const e = m.elements;
  let p = off;
  for (let i = 0; i < base.length; i += 3) {
    const x = base[i];
    const y = base[i + 1];
    const z = base[i + 2];
    out[p++] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[p++] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[p++] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
}
