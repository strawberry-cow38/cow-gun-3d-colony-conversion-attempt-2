/**
 * Floating sword + shield icon above drafted cows. Three InstancedMeshes
 * (blade, crossguard, shield) rebuild every frame since the drafted set is
 * tiny and the pieces bob + spin together as a unit.
 *
 * Pattern matches treeInstancer's axe marker: one shared rotation quat, one
 * per-cow matrix compose, instance count truncated to drafted cows.
 */

import * as THREE from 'three';
import { UNITS_PER_METER } from '../world/coords.js';

const BLADE_HEIGHT = 0.55 * UNITS_PER_METER;
const BLADE_WIDTH = 0.09 * UNITS_PER_METER;
const BLADE_DEPTH = 0.04 * UNITS_PER_METER;
const GUARD_WIDTH = 0.32 * UNITS_PER_METER;
const GUARD_HEIGHT = 0.06 * UNITS_PER_METER;
const GUARD_DEPTH = 0.06 * UNITS_PER_METER;
const SHIELD_WIDTH = 0.42 * UNITS_PER_METER;
const SHIELD_HEIGHT = 0.5 * UNITS_PER_METER;
const SHIELD_DEPTH = 0.05 * UNITS_PER_METER;
const SWORD_OFFSET_X = -0.22 * UNITS_PER_METER;
const SHIELD_OFFSET_X = 0.24 * UNITS_PER_METER;

const HOVER_BASE = 1.8 * UNITS_PER_METER;
const BOB_AMP = 0.12 * UNITS_PER_METER;
const BOB_FREQ_HZ = 1.1;
const SPIN_RATE = 0.85; // rad/sec, slow gentle spin

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createDraftBadge(scene, capacity = 256) {
  const bladeGeo = new THREE.BoxGeometry(BLADE_WIDTH, BLADE_HEIGHT, BLADE_DEPTH);
  // Origin at grip: blade sits above, guard below at y=0.
  bladeGeo.translate(SWORD_OFFSET_X, BLADE_HEIGHT * 0.5 + GUARD_HEIGHT * 0.5, 0);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xd8dde6,
    metalness: 0.6,
    roughness: 0.3,
  });
  const bladeMesh = new THREE.InstancedMesh(bladeGeo, bladeMat, capacity);
  bladeMesh.count = 0;
  bladeMesh.frustumCulled = false;
  scene.add(bladeMesh);

  const guardGeo = new THREE.BoxGeometry(GUARD_WIDTH, GUARD_HEIGHT, GUARD_DEPTH);
  guardGeo.translate(SWORD_OFFSET_X, 0, 0);
  const guardMat = new THREE.MeshStandardMaterial({ color: 0x8a6b2a, flatShading: true });
  const guardMesh = new THREE.InstancedMesh(guardGeo, guardMat, capacity);
  guardMesh.count = 0;
  guardMesh.frustumCulled = false;
  scene.add(guardMesh);

  const shieldGeo = new THREE.BoxGeometry(SHIELD_WIDTH, SHIELD_HEIGHT, SHIELD_DEPTH);
  shieldGeo.translate(SHIELD_OFFSET_X, 0, 0);
  const shieldMat = new THREE.MeshStandardMaterial({
    color: 0x5a7bb8,
    metalness: 0.3,
    roughness: 0.5,
    flatShading: true,
  });
  const shieldMesh = new THREE.InstancedMesh(shieldGeo, shieldMat, capacity);
  shieldMesh.count = 0;
  shieldMesh.frustumCulled = false;
  scene.add(shieldMesh);

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {number} timeSec
   */
  function update(world, timeSec) {
    const bob = BOB_AMP * Math.sin(timeSec * BOB_FREQ_HZ * Math.PI * 2);
    const yaw = timeSec * SPIN_RATE;
    _euler.set(0, yaw, 0);
    _quat.setFromEuler(_euler);
    let i = 0;
    for (const { components } of world.query(['Cow', 'Position'])) {
      if (!components.Cow.drafted) continue;
      if (i >= capacity) break;
      const pos = components.Position;
      _position.set(pos.x, pos.y + HOVER_BASE + bob, pos.z);
      _matrix.compose(_position, _quat, _scale);
      bladeMesh.setMatrixAt(i, _matrix);
      guardMesh.setMatrixAt(i, _matrix);
      shieldMesh.setMatrixAt(i, _matrix);
      i++;
    }
    bladeMesh.count = i;
    guardMesh.count = i;
    shieldMesh.count = i;
    bladeMesh.instanceMatrix.needsUpdate = true;
    guardMesh.instanceMatrix.needsUpdate = true;
    shieldMesh.instanceMatrix.needsUpdate = true;
  }

  return { update };
}
