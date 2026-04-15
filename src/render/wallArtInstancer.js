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

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let count = 0;
    for (const { components } of world.query(['WallArt', 'TileAnchor', 'WallArtViz'])) {
      if (count >= capacity) break;
      const a = components.TileAnchor;
      const art = components.WallArt;
      const size = Math.max(1, art.size | 0);
      const face = art.face | 0;
      const step = FACING_SPAN_OFFSETS[face] ?? FACING_SPAN_OFFSETS[0];
      const offset = FACING_OFFSETS[face] ?? FACING_OFFSETS[0];
      // Center across the span (size tiles) and push outward from the wall
      // face by half a tile + a proud offset so the slab sits in front of
      // the wall mesh instead of clipping into it.
      const midI = a.i + step.di * ((size - 1) * 0.5);
      const midJ = a.j + step.dj * ((size - 1) * 0.5);
      const w = tileToWorld(midI, midJ, grid.W, grid.H);
      const pushOut = TILE_SIZE * 0.5 + PROUD_OFFSET;
      const baseY = grid.getElevation(a.i, a.j);
      _position.set(
        w.x + offset.di * pushOut,
        baseY + MOUNT_Y,
        w.z + offset.dj * pushOut,
      );
      _euler.set(0, FACING_YAWS[face] ?? 0, 0);
      _quat.setFromEuler(_euler);
      // Width scales with span; height bumps slightly with size so huge
      // paintings read tall too.
      const width = BASE_WIDTH_PER_TILE * size;
      const heightScale = 1 + (size - 1) * 0.15;
      _scale.set(width, heightScale, 1);
      _matrix.compose(_position, _quat, _scale);
      frameMesh.setMatrixAt(count, _matrix);
      canvasMesh.setMatrixAt(count, _matrix);
      const palette = Array.isArray(art.palette) ? art.palette : [];
      const hex = palette[2] ?? palette[palette.length - 1] ?? '#e6d4a8';
      _color.set(hex);
      canvasMesh.setColorAt(count, _color);
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

  return { frameMesh, canvasMesh, update, markDirty };
}
