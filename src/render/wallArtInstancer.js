/**
 * WallArt renderer: paintings mounted on walls. Each WallArt entity anchors
 * on a single wall tile (the left/top of the span for size>1) and extends
 * `size` tiles perpendicular to its face direction.
 *
 * Visual is a flat frame-plus-canvas slab mounted a hair proud of the wall
 * face at roughly eye height, colored by the palette like paintingInstancer's
 * easel-side rendering. Kept deliberately simple — full painted detail can
 * come later; at gameplay distance a tint reads well enough.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { FACING_OFFSETS, FACING_SPAN_OFFSETS, FACING_YAWS } from '../world/facing.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const MOUNT_Y = WALL_HEIGHT * 0.55;
const PROUD_OFFSET = 0.15 * UNITS_PER_METER;
const FRAME_THICKNESS = 0.05 * UNITS_PER_METER;
const BASE_WIDTH_PER_TILE = TILE_SIZE * 0.82;
const BASE_HEIGHT = 0.7 * UNITS_PER_METER;
const FRAME_COLOR = 0x4a2d18;

/**
 * Shared placement math used by both the instanced render path and the
 * install-designator ghost, so the preview matches where the painting lands.
 *
 * @param {{ i: number, j: number }} anchor
 * @param {number} face
 * @param {number} size
 * @param {import('../world/tileGrid.js').TileGrid} grid
 */
export function computeWallArtTransform(anchor, face, size, grid) {
  const step = FACING_SPAN_OFFSETS[face] ?? FACING_SPAN_OFFSETS[0];
  const offset = FACING_OFFSETS[face] ?? FACING_OFFSETS[0];
  const midI = anchor.i + step.di * ((size - 1) * 0.5);
  const midJ = anchor.j + step.dj * ((size - 1) * 0.5);
  const w = tileToWorld(midI, midJ, grid.W, grid.H);
  const pushOut = TILE_SIZE * 0.5 + PROUD_OFFSET;
  const baseY = grid.inBounds(anchor.i, anchor.j) ? grid.getElevation(anchor.i, anchor.j) : 0;
  return {
    x: w.x + offset.di * pushOut,
    y: baseY + MOUNT_Y,
    z: w.z + offset.dj * pushOut,
    yaw: FACING_YAWS[face] ?? 0,
    width: BASE_WIDTH_PER_TILE * size,
    heightScale: 1 + (size - 1) * 0.15,
  };
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} [capacity]
 */
export function createWallArtInstancer(scene, capacity = 32) {
  const frameGeo = new THREE.BoxGeometry(1, BASE_HEIGHT, FRAME_THICKNESS);
  const frameMat = new THREE.MeshStandardMaterial({
    color: FRAME_COLOR,
    roughness: 0.9,
    metalness: 0.02,
  });
  const frameMesh = new THREE.InstancedMesh(frameGeo, frameMat, capacity);
  frameMesh.count = 0;
  frameMesh.frustumCulled = false;
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  scene.add(frameMesh);

  const canvasGeo = new THREE.BoxGeometry(1, BASE_HEIGHT * 0.86, FRAME_THICKNESS * 1.1);
  const canvasMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.75,
    metalness: 0.02,
  });
  const canvasMesh = new THREE.InstancedMesh(canvasGeo, canvasMat, capacity);
  canvasMesh.count = 0;
  canvasMesh.frustumCulled = false;
  canvasMesh.castShadow = true;
  canvasMesh.receiveShadow = true;
  scene.add(canvasMesh);

  let dirty = true;
  /** @type {number[]} instance slot → WallArt entity id. */
  const slotToEntity = [];

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let count = 0;
    slotToEntity.length = 0;
    for (const { id, components } of world.query(['WallArt', 'TileAnchor', 'WallArtViz'])) {
      if (count >= capacity) break;
      const a = components.TileAnchor;
      const art = components.WallArt;
      const size = Math.max(1, art.size | 0);
      const t = computeWallArtTransform(a, art.face | 0, size, grid);
      _position.set(t.x, t.y, t.z);
      _euler.set(0, t.yaw, 0);
      _quat.setFromEuler(_euler);
      _scale.set(t.width, t.heightScale, 1);
      _matrix.compose(_position, _quat, _scale);
      frameMesh.setMatrixAt(count, _matrix);
      canvasMesh.setMatrixAt(count, _matrix);
      const palette = Array.isArray(art.palette) ? art.palette : [];
      const hex = palette[2] ?? palette[palette.length - 1] ?? '#e6d4a8';
      _color.set(hex);
      canvasMesh.setColorAt(count, _color);
      slotToEntity[count] = id;
      count++;
    }
    frameMesh.count = count;
    canvasMesh.count = count;
    frameMesh.instanceMatrix.needsUpdate = true;
    canvasMesh.instanceMatrix.needsUpdate = true;
    if (canvasMesh.instanceColor) canvasMesh.instanceColor.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  /** @param {number} instanceId */
  function entityFromInstanceId(instanceId) {
    return slotToEntity[instanceId] ?? null;
  }

  return { frameMesh, canvasMesh, update, markDirty, entityFromInstanceId };
}

/**
 * Translucent frame+canvas preview group. Caller positions it via
 * `computeWallArtTransform` so the ghost lands where the painting will.
 *
 * @param {THREE.Scene} scene
 */
export function createWallArtGhost(scene) {
  const group = new THREE.Group();
  group.visible = false;
  group.frustumCulled = false;
  const frameMat = new THREE.MeshStandardMaterial({
    color: FRAME_COLOR,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    roughness: 0.9,
  });
  const canvasMat = new THREE.MeshStandardMaterial({
    color: 0xffe9b8,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    roughness: 0.75,
  });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1, BASE_HEIGHT, FRAME_THICKNESS), frameMat);
  const canvas = new THREE.Mesh(
    new THREE.BoxGeometry(1, BASE_HEIGHT * 0.86, FRAME_THICKNESS * 1.1),
    canvasMat,
  );
  group.add(frame, canvas);
  scene.add(group);
  return { group, frame, canvas, frameMat, canvasMat };
}
