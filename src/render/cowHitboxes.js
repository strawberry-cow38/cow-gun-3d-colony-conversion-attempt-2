/**
 * Click-hitbox InstancedMesh for cows. One oriented bounding box per cow
 * sized + transformed to match the rendered figure so clicks land reliably
 * at any RTS zoom. Pairs an invisible raycast-only mesh with a wireframe
 * debug mesh that the HUD flips on with the debug toggle (P).
 *
 * The hitbox follows cowInstancer's transform — heightCm scale, sleep
 * pitch (lay flat), swim sink — so tall colonists, sleeping colonists,
 * and swimming colonists all have their box where the silhouette is.
 *
 * See objectHitboxes.js for the invisible-raycast-mesh trick: setting
 * `visible=false` on the mesh skips rendering but a non-recursive
 * `raycaster.intersectObject(mesh, false)` still hits it.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, worldToTileClamp } from '../world/coords.js';
import { BIOME } from '../world/tileGrid.js';
import { LIE_DOWN_HEIGHT_M, REF_HEIGHT_CM, REF_HEIGHT_M, SWIM_SINK_M } from './cowInstancer.js';

// Figure AABB in meters at the reference height. Intentionally generous so
// clicks feel permissive and orientation-independent — a square footprint
// (W == D) means the player's side-on view of a standing colonist has the
// same click target as the front-on view. At heightCm=170 the rendered
// silhouette is ~0.6m wide (arm-to-arm) × ~0.25m deep × 1.79m tall; the
// hitbox adds slop around that.
const HITBOX_W_M = 1.0;
const HITBOX_H_M = REF_HEIGHT_M + 0.15;
const HITBOX_D_M = 1.0;

const HITBOX_W = HITBOX_W_M * UNITS_PER_METER;
const HITBOX_H = HITBOX_H_M * UNITS_PER_METER;
const HITBOX_D = HITBOX_D_M * UNITS_PER_METER;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

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

  // Debug wireframe. Shares a matrix with `mesh` each update; visibility is
  // flipped by the HUD's applyDebugVisibility. Bright yellow + depthTest
  // off so it reads through the figure the way debug overlays should.
  const dbgMat = new THREE.MeshBasicMaterial({
    color: 0xffdd33,
    wireframe: true,
    depthTest: false,
    transparent: true,
    opacity: 0.85,
  });
  const debugMesh = new THREE.InstancedMesh(geo, dbgMat, capacity);
  debugMesh.count = 0;
  debugMesh.frustumCulled = false;
  debugMesh.visible = false;
  debugMesh.renderOrder = 999;
  scene.add(debugMesh);

  /** @type {number[]} */
  const slotToEntity = [];

  /**
   * Match the cowInstancer transform minus the bob/roll wobble (we don't
   * want the click target to jitter). Pulls per-cow heightCm, swim state
   * from biome, and sleep state from the Job component.
   *
   * @param {import('../ecs/world.js').World} world
   * @param {number} alpha
   * @param {import('../world/tileGrid.js').TileGrid | null} [tileGrid]
   */
  function update(world, alpha = 1, tileGrid = null) {
    let n = 0;
    slotToEntity.length = 0;
    for (const { id, components } of world.query([
      'Cow',
      'Position',
      'PrevPosition',
      'Job',
      'Identity',
    ])) {
      if (n >= capacity) break;
      const p = components.Position;
      const pp = components.PrevPosition;
      const job = components.Job;
      const identity = components.Identity;

      const x = pp.x + (p.x - pp.x) * alpha;
      const y = pp.y + (p.y - pp.y) * alpha;
      const z = pp.z + (p.z - pp.z) * alpha;

      const sleeping = job.kind === 'sleep' && job.state === 'sleeping';
      let swimming = false;
      if (tileGrid && !sleeping) {
        const t = worldToTileClamp(x, z, tileGrid.W, tileGrid.H);
        swimming = tileGrid.biome[tileGrid.idx(t.i, t.j)] === BIOME.SHALLOW_WATER;
      }

      const heightFactor = (identity.heightCm || REF_HEIGHT_CM) / REF_HEIGHT_CM;
      const figureHeight = REF_HEIGHT_M * heightFactor * UNITS_PER_METER;
      const swimSink = SWIM_SINK_M * heightFactor * UNITS_PER_METER;
      const lieHeight = LIE_DOWN_HEIGHT_M * heightFactor * UNITS_PER_METER;

      // Match cowInstancer: centerY puts the figure center at y + half-
      // height, shifted by swimSink underwater, or flat on the ground
      // (lieHeight from spine to floor) when sleeping.
      const centerY = sleeping
        ? y + lieHeight
        : swimming
          ? y + figureHeight * 0.5 - swimSink
          : y + figureHeight * 0.5;

      // Pitch=π/2 flips the local Y axis to world +Z so the tall axis of
      // the box lies along the bed, matching the prone figure.
      const pitch = sleeping ? Math.PI / 2 : 0;
      _e.set(pitch, 0, 0);
      _q.setFromEuler(_e);
      _p.set(x, centerY, z);
      _s.set(HITBOX_W * heightFactor, HITBOX_H * heightFactor, HITBOX_D * heightFactor);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(n, _m);
      debugMesh.setMatrixAt(n, _m);
      slotToEntity[n] = id;
      n++;
    }
    mesh.count = n;
    debugMesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    debugMesh.instanceMatrix.needsUpdate = true;
    // Raycaster short-circuits on a stale bounding sphere (cached from the
    // first call when `count` may have been 0). Recompute every frame so
    // moving colonists stay clickable regardless of spawn order.
    mesh.computeBoundingSphere();
    debugMesh.computeBoundingSphere();
  }

  /** @param {number} instanceId @returns {number | null} */
  function entityFromInstanceId(instanceId) {
    return slotToEntity[instanceId] ?? null;
  }

  /** @param {boolean} v */
  function setDebugVisible(v) {
    debugMesh.visible = v;
  }

  return { mesh, debugMesh, update, entityFromInstanceId, setDebugVisible };
}
