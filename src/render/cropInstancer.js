/**
 * Crop render: one InstancedMesh for every live Crop. Visual is a simple
 * stage-scaled stem — final-stage crops bloom yellow to cue "ready to harvest".
 * Proper per-kind geometry (corn tassels, carrot tops, potato foliage) lands
 * with phase 3 once the picker UI exists; for now every crop is a cone.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { CROP_STAGES, cropIsReady, cropStageFor } from '../world/crops.js';

// Nominal stem height at stage 0..3 in metres, then stage 3 = final/mature.
const STAGE_HEIGHT_M = [0.08, 0.3, 0.65, 1.1];
const BASE_RADIUS_M = 0.15;
const STEM_COLOR = new THREE.Color(0x3a7a2a);
const MATURE_COLOR = new THREE.Color(0xd9c24a);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createCropInstancer(scene, capacity = 1024) {
  // Unit cone: radius=BASE_RADIUS_M, height=1m; per-instance scale.y sets stage.
  const radius = BASE_RADIUS_M * UNITS_PER_METER;
  const height = UNITS_PER_METER;
  const geo = new THREE.ConeGeometry(radius, height, 6);
  geo.translate(0, height * 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
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
    let i = 0;
    for (const { components } of world.query(['Crop', 'TileAnchor', 'CropViz'])) {
      if (i >= capacity) break;
      const a = components.TileAnchor;
      const c = components.Crop;
      const stage = cropStageFor(c.kind, c.growthTicks);
      const ready = cropIsReady(c.kind, c.growthTicks);
      const heightM = STAGE_HEIGHT_M[Math.min(stage, CROP_STAGES - 1)];
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      _position.set(w.x, grid.getElevation(a.i, a.j), w.z);
      _scale.set(1, heightM, 1);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(i, _matrix);
      mesh.setColorAt(i, ready ? MATURE_COLOR : STEM_COLOR);
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { mesh, update, markDirty };
}
