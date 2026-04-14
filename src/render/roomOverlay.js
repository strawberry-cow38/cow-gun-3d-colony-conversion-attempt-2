/**
 * Room overlay. One InstancedMesh of flat quads, one instance per interior
 * room tile, colored by room id so each enclosed region gets a distinct hue.
 * Exterior tiles and wall/door boundaries are left uncolored.
 *
 * Dirty flag is tripped by the rooms system's `onRebuilt` callback so the
 * overlay only reshuffles when topology actually changed.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const TILE_GROUND_CLEARANCE = 0.05 * UNITS_PER_METER;
const TILE_PAD = 0.06 * TILE_SIZE;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ');
const _scale = new THREE.Vector3(TILE_SIZE - TILE_PAD * 2, TILE_SIZE - TILE_PAD * 2, 1);
const _color = new THREE.Color();

/**
 * Golden-ratio hue stepping so adjacent room ids don't share visually close
 * hues. Room id → HSL color.
 * @param {number} id
 * @param {THREE.Color} out
 */
function hueForRoom(id, out) {
  const hue = (id * 0.6180339887) % 1;
  return out.setHSL(hue, 0.7, 0.55);
}

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createRoomOverlay(scene, capacity = 4096) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    vertexColors: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  // Prime instance-color buffer so THREE allocates it before first render.
  const priming = new THREE.Color(1, 1, 1);
  mesh.setColorAt(0, priming);
  scene.add(mesh);

  _quat.setFromEuler(_euler);
  let dirty = true;

  /**
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {import('../systems/rooms.js').RoomRegistry} rooms
   */
  function update(grid, rooms) {
    if (!dirty) return;
    let k = 0;
    const { W, H } = grid;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const id = rooms.roomId[j * W + i];
        if (id === 0) continue;
        if (k >= capacity) break;
        const w = tileToWorld(i, j, W, H);
        const y = grid.getElevation(i, j) + TILE_GROUND_CLEARANCE;
        _position.set(w.x, y, w.z);
        _matrix.compose(_position, _quat, _scale);
        mesh.setMatrixAt(k, _matrix);
        hueForRoom(id, _color);
        mesh.setColorAt(k, _color);
        k++;
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
