/**
 * Door render: one InstancedMesh per door. Doors are thin vertical slabs
 * sitting on the tile — tile-wide along one axis, slim along the other,
 * ~80% wall height. Orientation picks the axis with adjacent walls so the
 * door slots into a wall run; if no neighbor walls exist, defaults to
 * running along X.
 *
 * Matrix buffers rebuild on markDirty — build completion / door removal /
 * hydrate.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const DOOR_HEIGHT = 2.4 * UNITS_PER_METER;
const DOOR_THICKNESS = TILE_SIZE * 0.25;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3(1, 1, 1);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createDoorInstancer(scene, capacity = 512) {
  const material = new THREE.MeshStandardMaterial({ color: 0xb87333, flatShading: true });
  // Slab runs along local X by default; rotate per-instance when the door
  // should line up with a north-south wall run instead.
  const geo = new THREE.BoxGeometry(TILE_SIZE, DOOR_HEIGHT, DOOR_THICKNESS);
  geo.translate(0, DOOR_HEIGHT * 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    _scale.set(1, 1, 1);
    let n = 0;
    for (const { components } of world.query(['Door', 'TileAnchor', 'DoorViz'])) {
      if (n >= capacity) break;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      // Prefer running along whichever axis has adjacent walls. If walls
      // border east/west the door should bridge the X gap (default rotation);
      // if walls border north/south, rotate 90° so the slab bridges Z.
      const wallsEW = grid.isWall(a.i - 1, a.j) || grid.isWall(a.i + 1, a.j);
      const wallsNS = grid.isWall(a.i, a.j - 1) || grid.isWall(a.i, a.j + 1);
      const rotateNS = wallsNS && !wallsEW;
      _euler.set(0, rotateNS ? Math.PI / 2 : 0, 0);
      _quat.setFromEuler(_euler);
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(n++, _matrix);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { update, markDirty };
}
