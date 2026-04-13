/**
 * Cow render: one InstancedMesh, one draw call.
 *
 * Per-frame: lerp PrevPosition→Position by alpha, add a small sin-wave bob on
 * Y when the cow is actually moving (Velocity nonzero). Yaw is derived from
 * Velocity direction.
 *
 * `pickFromInstanceId` lets the selector translate a raycast hit's instanceId
 * back into the entity behind that slot.
 */

import * as THREE from 'three';
import { UNITS_PER_METER } from '../world/coords.js';

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

// Rough cow dimensions in meters. Low-poly placeholder — real mesh comes later.
const COW_WIDTH = 0.8 * UNITS_PER_METER;
const COW_HEIGHT = 1.0 * UNITS_PER_METER;
const COW_LENGTH = 1.8 * UNITS_PER_METER;
const COW_BOB_AMPLITUDE = 0.08 * UNITS_PER_METER;
const COW_BOB_FREQ_HZ = 6;

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createCowInstancer(scene, capacity = 256) {
  // Body is a brown box sized to real-ish cow dimensions. Real low-poly cow
  // mesh comes later.
  const geometry = new THREE.BoxGeometry(COW_WIDTH, COW_HEIGHT, COW_LENGTH);
  const material = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  /** @type {number[]} instance row → entity id */
  const slotToEntity = [];
  /** @type {Map<number, number>} entity id → last yaw, so stationary cows keep facing the direction they last walked. */
  const lastYaw = new Map();
  /** @type {Set<number>} scratch alive-set, cleared per frame to avoid per-frame Set allocation. */
  const seen = new Set();

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {number} alpha
   * @param {number} timeSec
   */
  function update(world, alpha, timeSec) {
    let i = 0;
    slotToEntity.length = 0;
    seen.clear();
    for (const { id, components } of world.query([
      'Cow',
      'Position',
      'PrevPosition',
      'Velocity',
      'CowViz',
    ])) {
      if (i >= capacity) break;
      const p = components.Position;
      const pp = components.PrevPosition;
      const v = components.Velocity;

      const x = pp.x + (p.x - pp.x) * alpha;
      const y = pp.y + (p.y - pp.y) * alpha;
      const z = pp.z + (p.z - pp.z) * alpha;

      const speedSq = v.x * v.x + v.z * v.z;
      const moving = speedSq > 0.01;
      const bob = moving
        ? COW_BOB_AMPLITUDE * Math.abs(Math.sin(timeSec * COW_BOB_FREQ_HZ * Math.PI))
        : 0;

      _position.set(x, y + COW_HEIGHT * 0.5 + bob, z);
      const yaw = moving ? Math.atan2(v.x, v.z) : (lastYaw.get(id) ?? 0);
      lastYaw.set(id, yaw);
      seen.add(id);
      _euler.set(0, yaw, 0);
      _quat.setFromEuler(_euler);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(i, _matrix);
      slotToEntity[i] = id;
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    // Drop yaw entries for cows that went away so the map doesn't leak.
    if (lastYaw.size > seen.size) {
      for (const entId of lastYaw.keys()) {
        if (!seen.has(entId)) lastYaw.delete(entId);
      }
    }
  }

  /** @param {number} instanceId */
  function entityFromInstanceId(instanceId) {
    return slotToEntity[instanceId] ?? null;
  }

  return { mesh, update, entityFromInstanceId };
}
