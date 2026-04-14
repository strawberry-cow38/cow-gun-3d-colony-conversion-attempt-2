/**
 * Tilled-soil overlay. Brown quads sit under the green farm-zone overlay to
 * show which tiles have been worked by cows into planting rows. Independent
 * of `farmZone` so an un-zoned-but-tilled tile (e.g. player cleared the zone
 * after tilling started) still reads as soil.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const TILE_GROUND_CLEARANCE = 0.06 * UNITS_PER_METER;
const TILE_PAD = 0.02 * TILE_SIZE;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ');
const _scale = new THREE.Vector3(TILE_SIZE - TILE_PAD * 2, TILE_SIZE - TILE_PAD * 2, 1);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createTilledOverlay(scene, capacity = 4096) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x6b3f1a,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  _quat.setFromEuler(_euler);
  let dirty = true;

  /** @param {import('../world/tileGrid.js').TileGrid} grid */
  function update(grid) {
    if (!dirty) return;
    let k = 0;
    for (let j = 0; j < grid.H; j++) {
      for (let i = 0; i < grid.W; i++) {
        if (!grid.isTilled(i, j)) continue;
        if (k >= capacity) break;
        const w = tileToWorld(i, j, grid.W, grid.H);
        const y = grid.getElevation(i, j) + TILE_GROUND_CLEARANCE;
        _position.set(w.x, y, w.z);
        _matrix.compose(_position, _quat, _scale);
        mesh.setMatrixAt(k, _matrix);
        k++;
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  /** @param {boolean} v */
  function setVisible(v) {
    mesh.visible = v;
  }

  return { mesh, update, markDirty, setVisible };
}
