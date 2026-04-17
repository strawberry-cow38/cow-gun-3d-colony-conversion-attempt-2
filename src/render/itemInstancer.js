/**
 * Item render: one InstancedMesh for all loose ground items (wood for now;
 * stone/food later will each get their own slot in the color palette).
 *
 * Items are static like trees — matrices written on demand when the item set
 * changes. Color varies by `Item.kind`.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { KIND_COLOR } from '../world/items.js';

const ITEM_SIZE = 0.35 * UNITS_PER_METER;
const MIN_HEIGHT_FRAC = 0.3;

const KIND_COLORS = /** @type {Record<string, THREE.Color>} */ (
  Object.fromEntries(Object.entries(KIND_COLOR).map(([k, hex]) => [k, new THREE.Color(hex)]))
);
const FALLBACK_COLOR = new THREE.Color(0xffffff);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createItemInstancer(scene, capacity = 1024) {
  const geo = new THREE.BoxGeometry(ITEM_SIZE, ITEM_SIZE, ITEM_SIZE);
  geo.translate(0, ITEM_SIZE * 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  scene.add(mesh);

  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let i = 0;
    for (const { components } of world.query(['Item', 'TileAnchor', 'ItemViz'])) {
      if (i >= capacity) break;
      const a = components.TileAnchor;
      const item = components.Item;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      const frac = Math.min(1, item.count / Math.max(1, item.capacity));
      _scale.set(1, MIN_HEIGHT_FRAC + (1 - MIN_HEIGHT_FRAC) * frac, 1);
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(i, _matrix);
      mesh.setColorAt(i, KIND_COLORS[item.kind] ?? FALLBACK_COLOR);
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { mesh, update, markDirty };
}
