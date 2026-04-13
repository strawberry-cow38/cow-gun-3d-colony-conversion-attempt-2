/**
 * Tree render: two InstancedMeshes (trunk + canopy), plus two more for the
 * chop-designation marker (handle + head of a floating axe icon) that only
 * render for trees with Tree.markedJobId > 0.
 *
 * Trunk + canopy are static — matrices rebuild only when the top-level
 * `dirty` flag is flipped by spawn/despawn. The axe marker bobs every frame,
 * so its matrices are rebuilt in `updateMarkers(world, grid, timeSec)` which
 * is cheap: there are only ever a handful of marked trees at once.
 *
 * `pickFromInstanceId` maps a trunk/canopy raycast hit back to the tree
 * entity behind that slot so the designator can mark it for chop.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const TRUNK_HEIGHT = 2.2 * UNITS_PER_METER;
const TRUNK_RADIUS = 0.18 * UNITS_PER_METER;
const CANOPY_RADIUS = 0.9 * UNITS_PER_METER;
const CANOPY_HEIGHT = 1.6 * UNITS_PER_METER;

const MARKER_HANDLE_LENGTH = 0.55 * UNITS_PER_METER;
const MARKER_HANDLE_RADIUS = 0.05 * UNITS_PER_METER;
const MARKER_HEAD_WIDTH = 0.35 * UNITS_PER_METER;
const MARKER_HEAD_HEIGHT = 0.18 * UNITS_PER_METER;
const MARKER_HEAD_DEPTH = 0.08 * UNITS_PER_METER;
const MARKER_HOVER_BASE = TRUNK_HEIGHT + CANOPY_HEIGHT + 0.3 * UNITS_PER_METER;
const MARKER_BOB_AMP = 0.15 * UNITS_PER_METER;
const MARKER_BOB_FREQ_HZ = 1.4;
const MARKER_SPIN_RATE = 1.1; // rad/sec

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
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
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3820, flatShading: true });
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, capacity);
  trunkMesh.count = 0;
  trunkMesh.frustumCulled = false;
  scene.add(trunkMesh);

  const canopyGeo = new THREE.ConeGeometry(CANOPY_RADIUS, CANOPY_HEIGHT, 7, 1);
  canopyGeo.translate(0, TRUNK_HEIGHT + CANOPY_HEIGHT * 0.5, 0);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2e6f3a, flatShading: true });
  const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, capacity);
  canopyMesh.count = 0;
  canopyMesh.frustumCulled = false;
  scene.add(canopyMesh);

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
  markerHandleMesh.frustumCulled = false;
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
  markerHeadMesh.frustumCulled = false;
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
    let i = 0;
    slotToEntity.length = 0;
    for (const { id, components } of world.query(['Tree', 'TileAnchor', 'TreeViz'])) {
      if (i >= capacity) break;
      const anchor = components.TileAnchor;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      trunkMesh.setMatrixAt(i, _matrix);
      canopyMesh.setMatrixAt(i, _matrix);
      slotToEntity[i] = id;
      i++;
    }
    trunkMesh.count = i;
    canopyMesh.count = i;
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
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
    let i = 0;
    for (const { components } of world.query(['Tree', 'TileAnchor', 'TreeViz'])) {
      if (components.Tree.markedJobId <= 0) continue;
      if (i >= markerCap) break;
      const anchor = components.TileAnchor;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      _position.set(w.x, y + MARKER_HOVER_BASE + bob, w.z);
      _matrix.compose(_position, _quat, _scale);
      markerHandleMesh.setMatrixAt(i, _matrix);
      markerHeadMesh.setMatrixAt(i, _matrix);
      i++;
    }
    markerHandleMesh.count = i;
    markerHeadMesh.count = i;
    markerHandleMesh.instanceMatrix.needsUpdate = true;
    markerHeadMesh.instanceMatrix.needsUpdate = true;
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
    canopyMesh,
    update,
    updateMarkers,
    markDirty,
    entityFromInstanceId,
  };
}
