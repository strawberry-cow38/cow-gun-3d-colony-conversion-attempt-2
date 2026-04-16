/**
 * Colonist render: a chibi humanoid built from several InstancedMeshes that
 * all share slot indices. One slot = one colonist. Each frame we compute a
 * base matrix per colonist (world position + bob + yaw/pitch/roll + height
 * scale) and multiply it with a static local offset per body part to get the
 * final instance matrix.
 *
 * Per-colonist variation comes from Identity: heightCm scales the whole
 * figure, hairColor tints the hair via setColorAt, and gender widens or
 * narrows the torso. Everything else is shared material.
 *
 * `pickFromInstanceId` / `.mesh` still expose a single InstancedMesh for the
 * CowSelector raycast; we use the torso since it's the biggest single block.
 * The selector's proximity fallback already handles misses on limbs.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld, worldToTileClamp } from '../world/coords.js';
import { BIOME } from '../world/tileGrid.js';

const _basePos = new THREE.Vector3();
const _baseQuat = new THREE.Quaternion();
const _baseEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _heightScale = new THREE.Vector3(1, 1, 1);
const _baseMatrix = new THREE.Matrix4();
const _finalMatrix = new THREE.Matrix4();
const _unitScale = new THREE.Vector3(1, 1, 1);
const _carryPos = new THREE.Vector3();
const _carryMatrix = new THREE.Matrix4();

const REF_HEIGHT_CM = 170;
const REF_HEIGHT_M = REF_HEIGHT_CM / 100;

// Canonical body part dimensions at 170cm. All in meters; converted to world
// units at mesh build time. Local offsets are in the figure's local frame —
// y=0 is the ground under the feet, +z is forward, +x is the colonist's left.
// Base matrix centers the figure at y = half-height, so we subtract REF_HEIGHT/2
// from each part's y to place it in the centered frame.
//
// `colorHex` is the material tint. `perInstanceColor: true` enables setColorAt
// (used for hair).
const PART_SPECS = [
  {
    name: 'head',
    size: { x: 0.2, y: 0.24, z: 0.22 },
    localPos: { x: 0, y: 1.58, z: 0 },
    colorHex: 0xdcb192,
  },
  {
    name: 'hair',
    size: { x: 0.23, y: 0.14, z: 0.25 },
    localPos: { x: 0, y: 1.72, z: 0 },
    colorHex: 0xffffff,
    perInstanceColor: true,
  },
  {
    name: 'torso',
    size: { x: 0.4, y: 0.6, z: 0.22 },
    localPos: { x: 0, y: 1.15, z: 0 },
    colorHex: 0x4a6a8a,
  },
  {
    name: 'leftArm',
    size: { x: 0.1, y: 0.6, z: 0.12 },
    localPos: { x: 0.25, y: 1.15, z: 0 },
    colorHex: 0x4a6a8a,
  },
  {
    name: 'rightArm',
    size: { x: 0.1, y: 0.6, z: 0.12 },
    localPos: { x: -0.25, y: 1.15, z: 0 },
    colorHex: 0x4a6a8a,
  },
  {
    name: 'leftLeg',
    size: { x: 0.14, y: 0.85, z: 0.16 },
    localPos: { x: 0.1, y: 0.425, z: 0 },
    colorHex: 0x2e3b4d,
  },
  {
    name: 'rightLeg',
    size: { x: 0.14, y: 0.85, z: 0.16 },
    localPos: { x: -0.1, y: 0.425, z: 0 },
    colorHex: 0x2e3b4d,
  },
];

// Gender-driven horizontal scale applied to the torso only. Female torsos
// render a bit narrower so the silhouette reads different at RTS zoom.
const TORSO_X_SCALE = { male: 1.12, female: 0.94, nonbinary: 1.0 };

const BOB_AMPLITUDE = 0.06 * UNITS_PER_METER;
const BOB_FREQ_HZ = 2.4;
const CHOP_PITCH_AMP = 0.44;
const CHOP_PITCH_FREQ_HZ = 2.5;
const SWIM_SINK_M = 0.6;
const SWIM_BOB_AMPLITUDE = 0.05 * UNITS_PER_METER;
const SWIM_BOB_FREQ_HZ = 1.6;
const SWIM_ROLL_AMP = 0.18;
const SWIM_ROLL_FREQ_HZ = 1.2;

const CARRY_SIZE = 0.35 * UNITS_PER_METER;
const CARRY_OFFSET_Y = 0.25 * UNITS_PER_METER;
/** @type {Record<string, THREE.Color>} */
const CARRY_COLORS = {
  wood: new THREE.Color(0x8a5a2e),
  stone: new THREE.Color(0x8a8a92),
  corn: new THREE.Color(0xd9c24a),
  carrot: new THREE.Color(0xe07b2a),
  potato: new THREE.Color(0x8a5a2a),
};
const CARRY_FALLBACK = new THREE.Color(0xffffff);

const _scratchColor = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createCowInstancer(scene, capacity = 256) {
  // Build an InstancedMesh per body part. All share the same slot index so
  // cow #3 is row 3 in every mesh.
  /**
   * @typedef {Object} PartRecord
   * @property {string} name
   * @property {THREE.InstancedMesh} mesh
   * @property {THREE.Matrix4} localMatrix     T(local) applied inside base frame
   * @property {{x:number, y:number, z:number}} localPos  meters, 170cm frame
   * @property {boolean} isTorso
   * @property {boolean} perInstanceColor
   */
  /** @type {PartRecord[]} */
  const parts = [];
  /** @type {THREE.InstancedMesh | null} */
  let torsoMesh = null;

  for (const spec of PART_SPECS) {
    const geo = new THREE.BoxGeometry(
      spec.size.x * UNITS_PER_METER,
      spec.size.y * UNITS_PER_METER,
      spec.size.z * UNITS_PER_METER,
    );
    const mat = new THREE.MeshStandardMaterial({ color: spec.colorHex, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const local = new THREE.Matrix4().makeTranslation(
      spec.localPos.x * UNITS_PER_METER,
      (spec.localPos.y - REF_HEIGHT_M / 2) * UNITS_PER_METER,
      spec.localPos.z * UNITS_PER_METER,
    );
    const rec = {
      name: spec.name,
      mesh,
      localMatrix: local,
      localPos: spec.localPos,
      isTorso: spec.name === 'torso',
      perInstanceColor: spec.perInstanceColor === true,
    };
    parts.push(rec);
    if (rec.isTorso) torsoMesh = mesh;
  }
  if (!torsoMesh) throw new Error('cowInstancer: torso part missing from PART_SPECS');

  const carryGeo = new THREE.BoxGeometry(CARRY_SIZE, CARRY_SIZE, CARRY_SIZE);
  const carryMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  const carryMesh = new THREE.InstancedMesh(carryGeo, carryMat, capacity);
  carryMesh.count = 0;
  carryMesh.frustumCulled = false;
  carryMesh.castShadow = true;
  scene.add(carryMesh);

  /** @type {number[]} instance row → entity id */
  const slotToEntity = [];
  /** @type {Map<number, number>} last yaw so stationary colonists keep facing forward */
  const lastYaw = new Map();
  /** @type {Set<number>} scratch alive-set */
  const seen = new Set();

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {number} alpha
   * @param {number} timeSec
   * @param {import('../world/tileGrid.js').TileGrid} [grid]
   * @param {number | null} [hideId]
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
      'Identity',
    ])) {
      if (i >= capacity) break;
      if (id === hideId) continue;
      const p = components.Position;
      const pp = components.PrevPosition;
      const v = components.Velocity;
      const job = components.Job;
      const identity = components.Identity;

      const x = pp.x + (p.x - pp.x) * alpha;
      const y = pp.y + (p.y - pp.y) * alpha;
      const z = pp.z + (p.z - pp.z) * alpha;

      const chopping = job.kind === 'chop' && job.state === 'chopping';
      const speedSq = v.x * v.x + v.z * v.z;
      const moving = speedSq > 0.01;

      let swimming = false;
      if (grid) {
        const t = worldToTileClamp(x, z, grid.W, grid.H);
        swimming = grid.biome[grid.idx(t.i, t.j)] === BIOME.SHALLOW_WATER;
      }

      let bob;
      let roll = 0;
      if (swimming) {
        bob = SWIM_BOB_AMPLITUDE * Math.sin(timeSec * SWIM_BOB_FREQ_HZ * Math.PI * 2);
        roll = SWIM_ROLL_AMP * Math.sin(timeSec * SWIM_ROLL_FREQ_HZ * Math.PI * 2);
      } else if (moving && !chopping) {
        bob = BOB_AMPLITUDE * Math.abs(Math.sin(timeSec * BOB_FREQ_HZ * Math.PI));
      } else {
        bob = 0;
      }

      let yaw;
      if (chopping && grid && typeof job.payload.i === 'number') {
        const tw = tileToWorld(job.payload.i, job.payload.j, grid.W, grid.H);
        yaw = Math.atan2(tw.x - x, tw.z - z);
      } else {
        yaw = moving ? Math.atan2(v.x, v.z) : (lastYaw.get(id) ?? 0);
      }
      lastYaw.set(id, yaw);
      seen.add(id);

      const pitch =
        chopping && !swimming
          ? CHOP_PITCH_AMP * Math.abs(Math.sin(timeSec * CHOP_PITCH_FREQ_HZ * Math.PI))
          : 0;

      const heightFactor = (identity.heightCm || REF_HEIGHT_CM) / REF_HEIGHT_CM;
      const figureHeight = REF_HEIGHT_M * heightFactor * UNITS_PER_METER;
      const swimSink = SWIM_SINK_M * heightFactor * UNITS_PER_METER;
      const centerY = swimming
        ? y + figureHeight * 0.5 - swimSink + bob
        : y + figureHeight * 0.5 + bob;

      _basePos.set(x, centerY, z);
      _baseEuler.set(pitch, yaw, roll);
      _baseQuat.setFromEuler(_baseEuler);
      _heightScale.set(heightFactor, heightFactor, heightFactor);
      _baseMatrix.compose(_basePos, _baseQuat, _heightScale);

      const torsoXScale = TORSO_X_SCALE[identity.gender] ?? 1;

      for (const part of parts) {
        if (part.isTorso && torsoXScale !== 1) {
          _finalMatrix.copy(part.localMatrix);
          _finalMatrix.elements[0] *= torsoXScale;
          _finalMatrix.elements[4] *= torsoXScale;
          _finalMatrix.elements[8] *= torsoXScale;
          _finalMatrix.premultiply(_baseMatrix);
        } else {
          _finalMatrix.multiplyMatrices(_baseMatrix, part.localMatrix);
        }
        part.mesh.setMatrixAt(i, _finalMatrix);
        if (part.perInstanceColor) {
          _scratchColor.set(identity.hairColor || '#4a2f20');
          part.mesh.setColorAt(i, _scratchColor);
        }
      }
      slotToEntity[i] = id;
      i++;

      const carrying = components.Inventory.items[0]?.kind ?? null;
      if (carrying && c < capacity) {
        _baseEuler.set(0, yaw, 0);
        _baseQuat.setFromEuler(_baseEuler);
        _carryPos.set(x, y + figureHeight + CARRY_OFFSET_Y, z);
        _carryMatrix.compose(_carryPos, _baseQuat, _unitScale);
        carryMesh.setMatrixAt(c, _carryMatrix);
        carryMesh.setColorAt(c, CARRY_COLORS[carrying] ?? CARRY_FALLBACK);
        c++;
      }
    }
    for (const part of parts) {
      part.mesh.count = i;
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.perInstanceColor && part.mesh.instanceColor && i > 0) {
        part.mesh.instanceColor.needsUpdate = true;
      }
    }
    carryMesh.count = c;
    carryMesh.instanceMatrix.needsUpdate = true;
    if (carryMesh.instanceColor && c > 0) carryMesh.instanceColor.needsUpdate = true;
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

  return { mesh: torsoMesh, update, entityFromInstanceId };
}
