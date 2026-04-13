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
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';

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
// Chopping rhythm: forward-lean pulse at ~2.5 Hz, 25° max lean.
const CHOP_PITCH_AMP = 0.44; // ≈ 25°
const CHOP_PITCH_FREQ_HZ = 2.5;

// Carried-item indicator: a small tinted cube hovering above the cow.
const CARRY_SIZE = 0.35 * UNITS_PER_METER;
const CARRY_OFFSET_Y = 0.25 * UNITS_PER_METER;
/** @type {Record<string, THREE.Color>} */
const CARRY_COLORS = {
  wood: new THREE.Color(0x8a5a2e),
  stone: new THREE.Color(0x8a8a92),
  food: new THREE.Color(0xd64a4a),
};
const CARRY_FALLBACK = new THREE.Color(0xffffff);

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

  const carryGeo = new THREE.BoxGeometry(CARRY_SIZE, CARRY_SIZE, CARRY_SIZE);
  const carryMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  const carryMesh = new THREE.InstancedMesh(carryGeo, carryMat, capacity);
  carryMesh.count = 0;
  carryMesh.frustumCulled = false;
  scene.add(carryMesh);

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
   * @param {import('../world/tileGrid.js').TileGrid} [grid] required for chop-facing yaw
   * @param {number | null} [hideId] cow to skip drawing entirely — used by the
   *   FP camera so the viewed cow's own model doesn't block the view. The
   *   cow still simulates normally, we just don't write an instance matrix.
   */
  function update(world, alpha, timeSec, grid, hideId = null) {
    let i = 0;
    let c = 0;
    slotToEntity.length = 0;
    seen.clear();
    for (const { id, components } of world.query([
      'Cow',
      'Position',
      'PrevPosition',
      'Velocity',
      'Job',
      'Inventory',
      'CowViz',
    ])) {
      if (i >= capacity) break;
      if (id === hideId) continue;
      const p = components.Position;
      const pp = components.PrevPosition;
      const v = components.Velocity;
      const job = components.Job;

      const x = pp.x + (p.x - pp.x) * alpha;
      const y = pp.y + (p.y - pp.y) * alpha;
      const z = pp.z + (p.z - pp.z) * alpha;

      const chopping = job.kind === 'chop' && job.state === 'chopping';
      const speedSq = v.x * v.x + v.z * v.z;
      const moving = speedSq > 0.01;
      const bob =
        moving && !chopping
          ? COW_BOB_AMPLITUDE * Math.abs(Math.sin(timeSec * COW_BOB_FREQ_HZ * Math.PI))
          : 0;

      // Face the tree while chopping so the forward-lean reads as "swinging at it".
      let yaw;
      if (chopping && grid && typeof job.payload.i === 'number') {
        const tw = tileToWorld(job.payload.i, job.payload.j, grid.W, grid.H);
        yaw = Math.atan2(tw.x - x, tw.z - z);
      } else {
        yaw = moving ? Math.atan2(v.x, v.z) : (lastYaw.get(id) ?? 0);
      }
      lastYaw.set(id, yaw);
      seen.add(id);

      // Clamped positive lean — the cow rocks forward (toward the tree) and
      // back to neutral, never backwards. |sin| gives the hit-then-recover feel.
      const pitch = chopping
        ? CHOP_PITCH_AMP * Math.abs(Math.sin(timeSec * CHOP_PITCH_FREQ_HZ * Math.PI))
        : 0;

      _position.set(x, y + COW_HEIGHT * 0.5 + bob, z);
      _euler.set(pitch, yaw, 0);
      _quat.setFromEuler(_euler);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(i, _matrix);
      slotToEntity[i] = id;
      i++;

      const carrying = components.Inventory.itemKind;
      if (carrying && c < capacity) {
        _euler.set(0, yaw, 0);
        _quat.setFromEuler(_euler);
        _position.set(x, y + COW_HEIGHT + CARRY_OFFSET_Y, z);
        _matrix.compose(_position, _quat, _scale);
        carryMesh.setMatrixAt(c, _matrix);
        carryMesh.setColorAt(c, CARRY_COLORS[carrying] ?? CARRY_FALLBACK);
        c++;
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    carryMesh.count = c;
    carryMesh.instanceMatrix.needsUpdate = true;
    // setColorAt lazily creates instanceColor on first call; guard AFTER so we
    // set needsUpdate even on the frame the attribute was just born.
    if (carryMesh.instanceColor && c > 0) carryMesh.instanceColor.needsUpdate = true;
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
