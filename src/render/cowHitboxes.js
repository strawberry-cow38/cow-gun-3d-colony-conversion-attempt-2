/**
 * Invisible click-hitbox InstancedMesh for cows. One AABB per cow sized to
 * encapsulate the full figure (head + hair + arms + legs) so clicks at RTS
 * zoom land reliably — the torso-only hit geometry the CowSelector used
 * before was barely a few pixels wide, which made selection feel fiddly.
 *
 * Mirrors the pattern in objectHitboxes.js: `visible = false` on the mesh
 * keeps it out of the draw path, but three's raycaster still hits it when
 * called non-recursively via `intersectObject(mesh, false)`.
 */

import * as THREE from 'three';
import { UNITS_PER_METER } from '../world/coords.js';

// Figure AABB in meters, a touch larger than the rendered silhouette so
// cursor imprecision is forgiven. Matches cowInstancer's PART_SPECS: hair
// top ≈ 1.79 m, arm outer reach ≈ 0.30 m, hair depth ≈ 0.125 m.
const HITBOX_W_M = 0.75;
const HITBOX_H_M = 1.95;
const HITBOX_D_M = 0.4;

const HITBOX_W = HITBOX_W_M * UNITS_PER_METER;
const HITBOX_H = HITBOX_H_M * UNITS_PER_METER;
const HITBOX_D = HITBOX_D_M * UNITS_PER_METER;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(HITBOX_W, HITBOX_H, HITBOX_D);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createCowHitboxes(scene, capacity = 256) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  /** @type {number[]} */
  const slotToEntity = [];

  /** @param {import('../ecs/world.js').World} world */
  function update(world) {
    let n = 0;
    slotToEntity.length = 0;
    _q.identity();
    for (const { id, components } of world.query(['Cow', 'Position'])) {
      if (n >= capacity) break;
      const pos = components.Position;
      _p.set(pos.x, pos.y + HITBOX_H * 0.5, pos.z);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(n, _m);
      slotToEntity[n] = id;
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** @param {number} instanceId @returns {number | null} */
  function entityFromInstanceId(instanceId) {
    return slotToEntity[instanceId] ?? null;
  }

  return { mesh, update, entityFromInstanceId };
}
