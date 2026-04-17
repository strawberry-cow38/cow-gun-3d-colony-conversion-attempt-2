/**
 * Tree render: two InstancedMeshes (trunk + canopy), plus two more for the
 * chop-designation marker (handle + head of a floating axe icon) that only
 * render for trees with Tree.markedJobId > 0.
 *
 * Per-instance trunk+canopy color comes from TREE_VISUALS[kind]; per-instance
 * scale combines kind-specific proportions with the tree's `growth` 0..1 (see
 * growthScale in trees.js). Trunk + canopy matrices rebuild only when the
 * top-level `dirty` flag is flipped — spawn, despawn, growth tick, or chop.
 * The axe marker bobs every frame, so its matrices are rebuilt in
 * `updateMarkers(world, grid, timeSec)` which is cheap: there are only ever
 * a handful of marked trees at once.
 *
 * `entityFromInstanceId` maps a trunk/canopy raycast hit back to the tree
 * entity behind that slot so the designator can mark it for chop.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { TREE_KINDS, TREE_VISUALS, growthScale } from '../world/trees.js';

const TRUNK_HEIGHT = 2.2 * UNITS_PER_METER;
const TRUNK_RADIUS = 0.18 * UNITS_PER_METER;
const CANOPY_RADIUS = 0.9 * UNITS_PER_METER;
const CANOPY_HEIGHT = 1.6 * UNITS_PER_METER;
const SPHERE_CANOPY_RADIUS = 0.9 * UNITS_PER_METER;

const MARKER_HANDLE_LENGTH = 0.55 * UNITS_PER_METER;
const MARKER_HANDLE_RADIUS = 0.05 * UNITS_PER_METER;
const MARKER_HEAD_WIDTH = 0.35 * UNITS_PER_METER;
const MARKER_HEAD_HEIGHT = 0.18 * UNITS_PER_METER;
const MARKER_HEAD_DEPTH = 0.08 * UNITS_PER_METER;
const MARKER_HOVER_BASE = TRUNK_HEIGHT + CANOPY_HEIGHT + 0.3 * UNITS_PER_METER;
const MARKER_BOB_AMP = 0.15 * UNITS_PER_METER;
const MARKER_BOB_FREQ_HZ = 1.4;
const MARKER_SPIN_RATE = 1.1; // rad/sec

// Pre-bake per-kind THREE.Color instances so setColorAt doesn't re-unpack a
// hex int on every instance write. Oak doubles as the fallback for unknown
// kinds (legacy saves default to oak too).
/** @type {Map<string, { trunk: THREE.Color, canopy: THREE.Color, trunkScale: number[], canopyScale: number[], canopyShape: 'cone' | 'sphere' }>} */
const TREE_DRAW = new Map();
for (const kind of TREE_KINDS) {
  const v = TREE_VISUALS[kind];
  if (!v) continue;
  TREE_DRAW.set(kind, {
    trunk: new THREE.Color(v.trunkColor),
    canopy: new THREE.Color(v.canopyColor),
    trunkScale: v.trunkScale,
    canopyScale: v.canopyScale,
    canopyShape: v.canopyShape,
  });
}
const FALLBACK_DRAW = /** @type {NonNullable<ReturnType<typeof TREE_DRAW.get>>} */ (
  TREE_DRAW.get('oak') ?? TREE_DRAW.get(TREE_KINDS[0])
);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _trunkScale = new THREE.Vector3(1, 1, 1);
const _canopyScale = new THREE.Vector3(1, 1, 1);
const _markerScale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createTreeInstancer(scene, capacity = 2048) {
  const trunkGeo = new THREE.CylinderGeometry(
    TRUNK_RADIUS * 0.75,
    TRUNK_RADIUS,
    TRUNK_HEIGHT,
    6,
    1,
  );
  trunkGeo.translate(0, TRUNK_HEIGHT * 0.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, capacity);
  trunkMesh.count = 0;
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  scene.add(trunkMesh);

  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });

  // Canopy geos are anchored at their own base (y=0) so update() can position
  // the canopy's base exactly at the (kind-scaled) trunk top without the
  // translate being stretched by instance scaleY.
  const canopyConeGeo = new THREE.ConeGeometry(CANOPY_RADIUS, CANOPY_HEIGHT, 7, 1);
  canopyConeGeo.translate(0, CANOPY_HEIGHT * 0.5, 0);
  const canopyConeMesh = new THREE.InstancedMesh(canopyConeGeo, canopyMat, capacity);
  canopyConeMesh.count = 0;
  canopyConeMesh.castShadow = true;
  canopyConeMesh.receiveShadow = true;
  scene.add(canopyConeMesh);

  const canopySphereGeo = new THREE.SphereGeometry(SPHERE_CANOPY_RADIUS, 8, 6);
  canopySphereGeo.translate(0, SPHERE_CANOPY_RADIUS, 0);
  const canopySphereMesh = new THREE.InstancedMesh(canopySphereGeo, canopyMat, capacity);
  canopySphereMesh.count = 0;
  canopySphereMesh.castShadow = true;
  canopySphereMesh.receiveShadow = true;
  scene.add(canopySphereMesh);

  // Axe marker. Handle offset so the grip sits at y=0 and the head at the top.
  const markerCap = Math.min(capacity, 256);
  const handleGeo = new THREE.CylinderGeometry(
    MARKER_HANDLE_RADIUS,
    MARKER_HANDLE_RADIUS,
    MARKER_HANDLE_LENGTH,
    6,
    1,
  );
  handleGeo.translate(0, MARKER_HANDLE_LENGTH * 0.5, 0);
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x6b3a1a, flatShading: true });
  const markerHandleMesh = new THREE.InstancedMesh(handleGeo, handleMat, markerCap);
  markerHandleMesh.count = 0;
  scene.add(markerHandleMesh);

  const headGeo = new THREE.BoxGeometry(MARKER_HEAD_WIDTH, MARKER_HEAD_HEIGHT, MARKER_HEAD_DEPTH);
  headGeo.translate(MARKER_HEAD_WIDTH * 0.3, MARKER_HANDLE_LENGTH - MARKER_HEAD_HEIGHT * 0.2, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xc8ced6,
    metalness: 0.5,
    roughness: 0.35,
  });
  const markerHeadMesh = new THREE.InstancedMesh(headGeo, headMat, markerCap);
  markerHeadMesh.count = 0;
  scene.add(markerHeadMesh);

  /** @type {number[]} slot → entity id */
  const slotToEntity = [];
  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let iTrunk = 0;
    let iCone = 0;
    let iSphere = 0;
    slotToEntity.length = 0;
    // _quat is shared with updateMarkers which spins it — reset to identity
    // so static trees render upright regardless of frame order.
    _quat.identity();
    for (const { id, components } of world.query(['Tree', 'TileAnchor', 'TreeViz'])) {
      if (iTrunk >= capacity) break;
      const anchor = components.TileAnchor;
      const tree = components.Tree;
      const draw = TREE_DRAW.get(tree.kind) ?? FALLBACK_DRAW;
      const g = growthScale(tree.growth);
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      _position.set(w.x, y, w.z);
      _trunkScale.set(draw.trunkScale[0] * g, draw.trunkScale[1] * g, draw.trunkScale[2] * g);
      _matrix.compose(_position, _quat, _trunkScale);
      trunkMesh.setMatrixAt(iTrunk, _matrix);
      trunkMesh.setColorAt(iTrunk, draw.trunk);
      const canopyY = y + TRUNK_HEIGHT * draw.trunkScale[1] * g;
      _position.set(w.x, canopyY, w.z);
      _canopyScale.set(draw.canopyScale[0] * g, draw.canopyScale[1] * g, draw.canopyScale[2] * g);
      _matrix.compose(_position, _quat, _canopyScale);
      if (draw.canopyShape === 'sphere') {
        canopySphereMesh.setMatrixAt(iSphere, _matrix);
        canopySphereMesh.setColorAt(iSphere, draw.canopy);
        iSphere++;
      } else {
        canopyConeMesh.setMatrixAt(iCone, _matrix);
        canopyConeMesh.setColorAt(iCone, draw.canopy);
        iCone++;
      }
      slotToEntity[iTrunk] = id;
      iTrunk++;
    }
    trunkMesh.count = iTrunk;
    canopyConeMesh.count = iCone;
    canopySphereMesh.count = iSphere;
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyConeMesh.instanceMatrix.needsUpdate = true;
    canopySphereMesh.instanceMatrix.needsUpdate = true;
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
    if (canopyConeMesh.instanceColor) canopyConeMesh.instanceColor.needsUpdate = true;
    if (canopySphereMesh.instanceColor) canopySphereMesh.instanceColor.needsUpdate = true;
    trunkMesh.computeBoundingSphere();
    canopyConeMesh.computeBoundingSphere();
    canopySphereMesh.computeBoundingSphere();
    dirty = false;
  }

  /**
   * Per-frame rebuild of the floating axe marker for every marked tree.
   * Cheap — a handful of marked trees tops.
   *
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {number} timeSec
   */
  function updateMarkers(world, grid, timeSec) {
    const bob = MARKER_BOB_AMP * Math.sin(timeSec * MARKER_BOB_FREQ_HZ * Math.PI * 2);
    const yaw = timeSec * MARKER_SPIN_RATE;
    _euler.set(0, yaw, 0);
    _quat.setFromEuler(_euler);
    _markerScale.set(1, 1, 1);
    let i = 0;
    for (const { components } of world.query(['Tree', 'TileAnchor', 'TreeViz'])) {
      const tree = components.Tree;
      if (tree.markedJobId <= 0) continue;
      if (i >= markerCap) break;
      const anchor = components.TileAnchor;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      // Follow the visible top of the tree so saplings don't have a marker
      // floating metres above their tiny canopy.
      const g = growthScale(tree.growth);
      _position.set(w.x, y + MARKER_HOVER_BASE * g + bob, w.z);
      _matrix.compose(_position, _quat, _markerScale);
      markerHandleMesh.setMatrixAt(i, _matrix);
      markerHeadMesh.setMatrixAt(i, _matrix);
      i++;
    }
    markerHandleMesh.count = i;
    markerHeadMesh.count = i;
    markerHandleMesh.instanceMatrix.needsUpdate = true;
    markerHeadMesh.instanceMatrix.needsUpdate = true;
    markerHandleMesh.computeBoundingSphere();
    markerHeadMesh.computeBoundingSphere();
  }

  function markDirty() {
    dirty = true;
  }

  /** @param {number} instanceId */
  function entityFromInstanceId(instanceId) {
    return slotToEntity[instanceId] ?? null;
  }

  return {
    trunkMesh,
    canopyConeMesh,
    canopySphereMesh,
    update,
    updateMarkers,
    markDirty,
    entityFromInstanceId,
  };
}
