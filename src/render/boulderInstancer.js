/**
 * Boulder render: one InstancedMesh tinted per kind via setColorAt, plus a
 * pickaxe-shaped floating marker (handle + head) that only renders for marked
 * boulders. Follows the treeInstancer layout: lazy static rebuild gated on a
 * `dirty` flag; marker rebuilt every frame since there are only a handful.
 */

import * as THREE from 'three';
import { BOULDER_KINDS, BOULDER_VISUALS } from '../world/boulders.js';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const ROCK_RADIUS = 0.55 * UNITS_PER_METER;
const ROCK_HEIGHT = 0.9 * UNITS_PER_METER;

const MARKER_HANDLE_LENGTH = 0.55 * UNITS_PER_METER;
const MARKER_HANDLE_RADIUS = 0.05 * UNITS_PER_METER;
const MARKER_HEAD_WIDTH = 0.4 * UNITS_PER_METER;
const MARKER_HEAD_HEIGHT = 0.12 * UNITS_PER_METER;
const MARKER_HEAD_DEPTH = 0.08 * UNITS_PER_METER;
const MARKER_HOVER_BASE = ROCK_HEIGHT + 0.3 * UNITS_PER_METER;
const MARKER_BOB_AMP = 0.15 * UNITS_PER_METER;
const MARKER_BOB_FREQ_HZ = 1.4;
const MARKER_SPIN_RATE = 1.1;

/** @type {Map<string, { color: THREE.Color, scale: number[] }>} */
const BOULDER_DRAW = new Map();
for (const kind of BOULDER_KINDS) {
  const v = BOULDER_VISUALS[kind];
  if (!v) continue;
  BOULDER_DRAW.set(kind, { color: new THREE.Color(v.color), scale: v.scale });
}
const FALLBACK_DRAW = /** @type {NonNullable<ReturnType<typeof BOULDER_DRAW.get>>} */ (
  BOULDER_DRAW.get('stone') ?? BOULDER_DRAW.get(BOULDER_KINDS[0])
);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _markerScale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createBoulderInstancer(scene, capacity = 4096) {
  const rockGeo = new THREE.DodecahedronGeometry(ROCK_RADIUS, 0);
  rockGeo.scale(1, ROCK_HEIGHT / (ROCK_RADIUS * 2), 1);
  rockGeo.translate(0, ROCK_HEIGHT * 0.5, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, capacity);
  rockMesh.count = 0;
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  scene.add(rockMesh);

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
  headGeo.translate(0, MARKER_HANDLE_LENGTH - MARKER_HEAD_HEIGHT * 0.2, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xc8ced6,
    metalness: 0.5,
    roughness: 0.35,
  });
  const markerHeadMesh = new THREE.InstancedMesh(headGeo, headMat, markerCap);
  markerHeadMesh.count = 0;
  scene.add(markerHeadMesh);

  /** @type {number[]} */
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
    _quat.identity();
    for (const { id, components } of world.query(['Boulder', 'TileAnchor', 'BoulderViz'])) {
      if (i >= capacity) break;
      const anchor = components.TileAnchor;
      const boulder = components.Boulder;
      const draw = BOULDER_DRAW.get(boulder.kind) ?? FALLBACK_DRAW;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      _position.set(w.x, y, w.z);
      _scale.set(draw.scale[0], draw.scale[1], draw.scale[2]);
      _matrix.compose(_position, _quat, _scale);
      rockMesh.setMatrixAt(i, _matrix);
      rockMesh.setColorAt(i, draw.color);
      slotToEntity[i] = id;
      i++;
    }
    rockMesh.count = i;
    rockMesh.instanceMatrix.needsUpdate = true;
    if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
    rockMesh.computeBoundingSphere();
    dirty = false;
  }

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
    _markerScale.set(1, 1, 1);
    let i = 0;
    for (const { components } of world.query(['Boulder', 'TileAnchor', 'BoulderViz'])) {
      const boulder = components.Boulder;
      if (boulder.markedJobId <= 0) continue;
      if (i >= markerCap) break;
      const anchor = components.TileAnchor;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      _position.set(w.x, y + MARKER_HOVER_BASE + bob, w.z);
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
    rockMesh,
    update,
    updateMarkers,
    markDirty,
    entityFromInstanceId,
  };
}
