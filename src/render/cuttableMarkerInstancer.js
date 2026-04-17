/**
 * Floating scissors marker for any entity with `Cuttable.markedJobId > 0`.
 * Generic over the entity type so trees, crops, and any future wild foliage
 * with a Cuttable component all show the same icon.
 *
 * Two crossed thin blade-boxes form the X silhouette; tiny ring handles at
 * the bottom finish the scissors read at RTS zoom. Bobs + spins like the
 * chop axe and mine pick markers, on the same per-frame cadence.
 *
 * Hover height is derived per entity-kind: trees follow the visible top of
 * their growth-scaled canopy (so saplings get a low marker), crops follow
 * their stage-height cone, anything else falls back to a fixed offset.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { CROP_STAGES, cropStageFor } from '../world/crops.js';
import { growthScale } from '../world/trees.js';

const TREE_TOP_M = 3.8; // matches treeInstancer trunk(2.2) + canopy(1.6)
const CROP_STAGE_TOP_M = [0.08, 0.3, 0.65, 1.1];
const FALLBACK_TOP_M = 1.0;
const HOVER_PAD_M = 0.3;

const BLADE_LENGTH = 0.5 * UNITS_PER_METER;
const BLADE_THICK = 0.045 * UNITS_PER_METER;
const BLADE_DEPTH = 0.05 * UNITS_PER_METER;
const HANDLE_RADIUS = 0.1 * UNITS_PER_METER;
const HANDLE_TUBE = 0.025 * UNITS_PER_METER;
const BLADE_TILT = Math.PI / 9; // ~20° from vertical, mirrored on the two blades
const HANDLE_DROP = -BLADE_LENGTH * 0.5;
const HANDLE_SPLAY = BLADE_LENGTH * 0.18;

const MARKER_BOB_AMP = 0.15 * UNITS_PER_METER;
const MARKER_BOB_FREQ_HZ = 1.4;
const MARKER_SPIN_RATE = 1.1;

const BLADE_COLOR = 0xd4dde4;
const HANDLE_COLOR = 0x222831;

const _matrix = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _outer = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _bladeQuat = new THREE.Quaternion();
const _bladeOffset = new THREE.Vector3();
const _handleOffset = new THREE.Vector3();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createCuttableMarkerInstancer(scene, capacity = 256) {
  const bladeGeo = new THREE.BoxGeometry(BLADE_THICK, BLADE_LENGTH, BLADE_DEPTH);
  bladeGeo.translate(0, BLADE_LENGTH * 0.4, 0);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: BLADE_COLOR,
    metalness: 0.55,
    roughness: 0.3,
  });
  const bladeMesh = new THREE.InstancedMesh(bladeGeo, bladeMat, capacity * 2);
  bladeMesh.count = 0;
  scene.add(bladeMesh);

  const handleGeo = new THREE.TorusGeometry(HANDLE_RADIUS, HANDLE_TUBE, 6, 12);
  const handleMat = new THREE.MeshStandardMaterial({
    color: HANDLE_COLOR,
    metalness: 0.2,
    roughness: 0.6,
  });
  const handleMesh = new THREE.InstancedMesh(handleGeo, handleMat, capacity * 2);
  handleMesh.count = 0;
  scene.add(handleMesh);

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {number} timeSec
   */
  function updateMarkers(world, grid, timeSec) {
    const bob = MARKER_BOB_AMP * Math.sin(timeSec * MARKER_BOB_FREQ_HZ * Math.PI * 2);
    const yaw = timeSec * MARKER_SPIN_RATE;
    _euler.set(0, yaw, 0);
    _quat.setFromEuler(_euler);
    _scale.set(1, 1, 1);
    let i = 0;
    for (const { id, components } of world.query(['Cuttable', 'TileAnchor'])) {
      const cut = components.Cuttable;
      if (cut.markedJobId <= 0) continue;
      if (i >= capacity) break;
      const anchor = components.TileAnchor;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const groundY = grid.getElevation(anchor.i, anchor.j);
      const topM = topMetersFor(world, id);
      _position.set(
        w.x,
        groundY + topM * UNITS_PER_METER + HOVER_PAD_M * UNITS_PER_METER + bob,
        w.z,
      );
      _outer.compose(_position, _quat, _scale);
      writeBladePair(bladeMesh, i, _outer);
      writeHandlePair(handleMesh, i, _outer);
      i++;
    }
    bladeMesh.count = i * 2;
    handleMesh.count = i * 2;
    bladeMesh.instanceMatrix.needsUpdate = true;
    handleMesh.instanceMatrix.needsUpdate = true;
    bladeMesh.computeBoundingSphere();
    handleMesh.computeBoundingSphere();
  }

  return { bladeMesh, handleMesh, updateMarkers };
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {number} entityId
 */
function topMetersFor(world, entityId) {
  const tree = world.get(entityId, 'Tree');
  if (tree) return TREE_TOP_M * growthScale(tree.growth);
  const crop = world.get(entityId, 'Crop');
  if (crop) {
    const stage = cropStageFor(crop.kind, crop.growthTicks);
    return CROP_STAGE_TOP_M[Math.min(stage, CROP_STAGES - 1)];
  }
  return FALLBACK_TOP_M;
}

/**
 * @param {THREE.InstancedMesh} mesh
 * @param {number} markerIndex
 * @param {THREE.Matrix4} outer
 */
function writeBladePair(mesh, markerIndex, outer) {
  for (let s = 0; s < 2; s++) {
    const tilt = s === 0 ? BLADE_TILT : -BLADE_TILT;
    _euler.set(0, 0, tilt);
    _bladeQuat.setFromEuler(_euler);
    _bladeOffset.set(0, 0, 0);
    _local.compose(_bladeOffset, _bladeQuat, _scale);
    _matrix.multiplyMatrices(outer, _local);
    mesh.setMatrixAt(markerIndex * 2 + s, _matrix);
  }
}

/**
 * @param {THREE.InstancedMesh} mesh
 * @param {number} markerIndex
 * @param {THREE.Matrix4} outer
 */
function writeHandlePair(mesh, markerIndex, outer) {
  // Handles lie flat (rotate the torus 90° onto the XY plane) and splay
  // outward at the bottom of each blade.
  _euler.set(Math.PI * 0.5, 0, 0);
  _bladeQuat.setFromEuler(_euler);
  for (let s = 0; s < 2; s++) {
    const dx = s === 0 ? HANDLE_SPLAY : -HANDLE_SPLAY;
    _handleOffset.set(dx, HANDLE_DROP, 0);
    _local.compose(_handleOffset, _bladeQuat, _scale);
    _matrix.multiplyMatrices(outer, _local);
    mesh.setMatrixAt(markerIndex * 2 + s, _matrix);
  }
}
