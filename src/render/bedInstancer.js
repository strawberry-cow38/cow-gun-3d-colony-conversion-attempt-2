/**
 * Bed renderer. Two boxes: a low mattress slab spanning two tiles and a short
 * headboard at the anchor end. The bed's long axis runs along the facing
 * direction; cows can walk onto either tile to lie down.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { FACING_OFFSETS, FACING_YAWS } from '../world/facing.js';

/** Mattress dimensions — long axis runs forward along facing. */
export const BED_LENGTH = TILE_SIZE * 1.9;
export const BED_WIDTH = TILE_SIZE * 0.8;
export const BED_HEIGHT = 0.35 * UNITS_PER_METER;
export const BED_HEADBOARD_HEIGHT = 0.75 * UNITS_PER_METER;
export const BED_HEADBOARD_THICKNESS = TILE_SIZE * 0.18;

const MATTRESS_COLOR = 0xc7a07a;
const FRAME_COLOR = 0x6a4a2a;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * @param {THREE.Scene} scene
 * @param {number} [capacity]
 */
export function createBedInstancer(scene, capacity = 64) {
  const mattressGeo = new THREE.BoxGeometry(BED_WIDTH, BED_HEIGHT, BED_LENGTH);
  mattressGeo.translate(0, BED_HEIGHT * 0.5, 0);
  const mattressMat = new THREE.MeshStandardMaterial({
    color: MATTRESS_COLOR,
    roughness: 0.95,
    metalness: 0.02,
  });
  const mattressMesh = new THREE.InstancedMesh(mattressGeo, mattressMat, capacity);
  mattressMesh.count = 0;
  mattressMesh.frustumCulled = false;
  mattressMesh.castShadow = true;
  mattressMesh.receiveShadow = true;
  scene.add(mattressMesh);

  const headboardGeo = new THREE.BoxGeometry(
    BED_WIDTH,
    BED_HEADBOARD_HEIGHT,
    BED_HEADBOARD_THICKNESS,
  );
  headboardGeo.translate(0, BED_HEADBOARD_HEIGHT * 0.5, 0);
  const headboardMat = new THREE.MeshStandardMaterial({
    color: FRAME_COLOR,
    roughness: 0.9,
    metalness: 0.05,
  });
  const headboardMesh = new THREE.InstancedMesh(headboardGeo, headboardMat, capacity);
  headboardMesh.count = 0;
  headboardMesh.frustumCulled = false;
  headboardMesh.castShadow = true;
  headboardMesh.receiveShadow = true;
  scene.add(headboardMesh);

  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    _scale.set(1, 1, 1);
    let i = 0;
    for (const { components } of world.query(['Bed', 'TileAnchor', 'BedViz'])) {
      if (i >= capacity) break;
      const a = components.TileAnchor;
      const facing = components.Bed.facing | 0;
      const off = FACING_OFFSETS[facing] ?? FACING_OFFSETS[0];
      const anchorWorld = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      // Mattress center sits between anchor and forward tile.
      const cx = anchorWorld.x + off.di * (TILE_SIZE / 2);
      const cz = anchorWorld.z + off.dj * (TILE_SIZE / 2);
      const yaw = FACING_YAWS[facing] ?? 0;
      _quat.setFromAxisAngle(_yAxis, yaw);

      _position.set(cx, y, cz);
      _matrix.compose(_position, _quat, _scale);
      mattressMesh.setMatrixAt(i, _matrix);

      // Headboard sits at the forward end of the mattress (away from anchor)
      // so it reads as the head of the bed.
      const headOffset = BED_LENGTH * 0.5 - BED_HEADBOARD_THICKNESS * 0.5;
      const hx = cx + off.di * headOffset;
      const hz = cz + off.dj * headOffset;
      _position.set(hx, y, hz);
      _matrix.compose(_position, _quat, _scale);
      headboardMesh.setMatrixAt(i, _matrix);
      i++;
    }
    mattressMesh.count = i;
    headboardMesh.count = i;
    mattressMesh.instanceMatrix.needsUpdate = true;
    headboardMesh.instanceMatrix.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { mattressMesh, headboardMesh, update, markDirty };
}

/**
 * Ghost (build-preview) silhouette for bed placement.
 *
 * @param {THREE.Scene} scene
 */
export function createBedGhost(scene) {
  const group = new THREE.Group();
  const mattressGeo = new THREE.BoxGeometry(BED_WIDTH, BED_HEIGHT, BED_LENGTH);
  // Group is placed at the anchor (foot) tile and rotated by facing. Shift
  // mattress forward half a tile in local +Z so it spans anchor→forward.
  mattressGeo.translate(0, BED_HEIGHT * 0.5, TILE_SIZE * 0.5);
  const mattressMat = new THREE.MeshStandardMaterial({
    color: MATTRESS_COLOR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const mattress = new THREE.Mesh(mattressGeo, mattressMat);
  const headboardGeo = new THREE.BoxGeometry(
    BED_WIDTH,
    BED_HEADBOARD_HEIGHT,
    BED_HEADBOARD_THICKNESS,
  );
  // Headboard sits at the forward (head) end of the mattress.
  headboardGeo.translate(0, BED_HEADBOARD_HEIGHT * 0.5, TILE_SIZE - BED_HEADBOARD_THICKNESS * 0.5);
  const headboardMat = new THREE.MeshStandardMaterial({
    color: FRAME_COLOR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const headboard = new THREE.Mesh(headboardGeo, headboardMat);
  group.add(mattress);
  group.add(headboard);
  group.visible = false;
  scene.add(group);
  return { group };
}
