/**
 * Stove renderer. A 3-tile-wide boxy hearth: a stone base spanning the full
 * footprint with a slim chimney rising from the center. The body aligns its
 * long axis to the facing's perpendicular span so it visually sits across
 * all three blocked tiles.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { FACING_YAWS } from '../world/facing.js';

export const STOVE_BODY_HEIGHT = 0.85 * UNITS_PER_METER;
export const STOVE_BODY_SPAN = TILE_SIZE * 2.85;
export const STOVE_BODY_DEPTH = TILE_SIZE * 0.75;
export const STOVE_CHIMNEY_HEIGHT = 1.0 * UNITS_PER_METER;
export const STOVE_CHIMNEY_WIDTH = 0.22 * UNITS_PER_METER;

const STONE_COLOR = 0x8d8d93;
const CHIMNEY_COLOR = 0x3a3236;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * @param {THREE.Scene} scene
 * @param {number} [capacity]
 */
export function createStoveInstancer(scene, capacity = 32) {
  const bodyGeo = new THREE.BoxGeometry(STOVE_BODY_SPAN, STOVE_BODY_HEIGHT, STOVE_BODY_DEPTH);
  bodyGeo.translate(0, STOVE_BODY_HEIGHT * 0.5, 0);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: STONE_COLOR,
    roughness: 0.95,
    metalness: 0.03,
  });
  const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, capacity);
  bodyMesh.count = 0;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  scene.add(bodyMesh);

  const chimneyGeo = new THREE.BoxGeometry(
    STOVE_CHIMNEY_WIDTH,
    STOVE_CHIMNEY_HEIGHT,
    STOVE_CHIMNEY_WIDTH,
  );
  chimneyGeo.translate(0, STOVE_BODY_HEIGHT + STOVE_CHIMNEY_HEIGHT * 0.5, 0);
  const chimneyMat = new THREE.MeshStandardMaterial({
    color: CHIMNEY_COLOR,
    roughness: 0.85,
    metalness: 0.1,
  });
  const chimneyMesh = new THREE.InstancedMesh(chimneyGeo, chimneyMat, capacity);
  chimneyMesh.count = 0;
  chimneyMesh.castShadow = true;
  chimneyMesh.receiveShadow = true;
  scene.add(chimneyMesh);

  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    _scale.set(1, 1, 1);
    let i = 0;
    for (const { components } of world.query(['Stove', 'TileAnchor', 'StoveViz'])) {
      if (i >= capacity) break;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      const facing = components.Stove.facing | 0;
      const yaw = FACING_YAWS[facing] ?? 0;
      _quat.setFromAxisAngle(_yAxis, yaw);

      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      bodyMesh.setMatrixAt(i, _matrix);
      chimneyMesh.setMatrixAt(i, _matrix);
      i++;
    }
    bodyMesh.count = i;
    chimneyMesh.count = i;
    bodyMesh.instanceMatrix.needsUpdate = true;
    chimneyMesh.instanceMatrix.needsUpdate = true;
    bodyMesh.computeBoundingSphere();
    chimneyMesh.computeBoundingSphere();
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { bodyMesh, chimneyMesh, update, markDirty };
}

/**
 * Ghost (build-preview) silhouette — single translucent block sized like the
 * stove body. Positioned on the hover tile and rotated per facing.
 *
 * @param {THREE.Scene} scene
 */
export function createStoveGhost(scene) {
  const group = new THREE.Group();
  const bodyGeo = new THREE.BoxGeometry(STOVE_BODY_SPAN, STOVE_BODY_HEIGHT, STOVE_BODY_DEPTH);
  bodyGeo.translate(0, STOVE_BODY_HEIGHT * 0.5, 0);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: STONE_COLOR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  const chimneyGeo = new THREE.BoxGeometry(
    STOVE_CHIMNEY_WIDTH,
    STOVE_CHIMNEY_HEIGHT,
    STOVE_CHIMNEY_WIDTH,
  );
  chimneyGeo.translate(0, STOVE_BODY_HEIGHT + STOVE_CHIMNEY_HEIGHT * 0.5, 0);
  const chimneyMat = new THREE.MeshStandardMaterial({
    color: CHIMNEY_COLOR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
  group.add(body);
  group.add(chimney);
  group.visible = false;
  scene.add(group);
  return { group };
}
