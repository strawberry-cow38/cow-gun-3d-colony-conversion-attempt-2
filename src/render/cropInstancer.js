/**
 * Crop render: one InstancedMesh for every live Crop, keyed off the per-kind
 * palette + scale triple in CROP_VISUALS. Stem → mature lerp is linear in
 * stage fraction, so stage 0 is full stemColor and final stage is full
 * ripeColor. The unit cone geometry is scaled per-instance to produce corn
 * tall-and-skinny, carrot squat-and-wide, potato low-and-bushy — good enough
 * to tell apart at an RTS zoom without per-kind meshes.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import {
  CROP_KINDS,
  CROP_STAGES,
  CROP_VISUALS,
  cropIsReady,
  cropStageFor,
} from '../world/crops.js';

const STAGE_HEIGHT_M = [0.08, 0.3, 0.65, 1.1];
const BASE_RADIUS_M = 0.15;

// Pre-bake per-kind THREE.Color instances so the instance loop only does copy
// + lerp (three float assignments each) rather than re-unpacking hex ints
// every frame. Corn doubles as the fallback for unknown kinds.
const CROP_DRAW = new Map();
for (const kind of CROP_KINDS) {
  const v = CROP_VISUALS[kind];
  if (!v) continue;
  CROP_DRAW.set(kind, {
    stem: new THREE.Color(v.stemColor),
    ripe: new THREE.Color(v.ripeColor),
    scale: v.scale,
  });
}
const FALLBACK_DRAW = CROP_DRAW.get(CROP_KINDS[0]);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createCropInstancer(scene, capacity = 1024) {
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
      const draw = CROP_DRAW.get(c.kind) ?? FALLBACK_DRAW;
      const stage = cropStageFor(c.kind, c.growthTicks);
      const heightM = STAGE_HEIGHT_M[Math.min(stage, CROP_STAGES - 1)];
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      _position.set(w.x, grid.getElevation(a.i, a.j), w.z);
      _scale.set(draw.scale[0], heightM * draw.scale[1], draw.scale[2]);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(i, _matrix);
      // Lerp stem → ripe by stage fraction — the final stage is full ripe.
      const tReady = cropIsReady(c.kind, c.growthTicks) ? 1 : stage / Math.max(1, CROP_STAGES - 1);
      _color.copy(draw.stem).lerp(draw.ripe, tReady);
      mesh.setColorAt(i, _color);
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
