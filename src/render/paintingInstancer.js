/**
 * Painting renderer. Each finished painting spawns as an Item+Painting entity
 * on its easel tile. We render it as a small framed canvas standing upright,
 * so the player can see it alongside the easel. Frame is dark wood; canvas
 * tint comes from the painting's palette (chosen per-instance via setColorAt).
 *
 * Paintings use PaintingViz as their instancer tag and deliberately omit
 * ItemViz at spawn time, so itemInstancer doesn't also draw them as a tan
 * cube on top.
 *
 * Full painted detail (baked shapes from `Painting.shapes` onto a canvas
 * texture) is deferred — a single tint read well enough at gameplay distance.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const FRAME_THICKNESS = 0.05 * UNITS_PER_METER;
const BASE_WIDTH = TILE_SIZE * 0.5;
const BASE_HEIGHT = 0.45 * UNITS_PER_METER;

const FRAME_COLOR = 0x4a2d18;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} [capacity]
 */
export function createPaintingInstancer(scene, capacity = 32) {
  const frameGeo = new THREE.BoxGeometry(BASE_WIDTH, BASE_HEIGHT, FRAME_THICKNESS);
  frameGeo.translate(0, BASE_HEIGHT * 0.5, 0);
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

  // Canvas geometry is inset on X/Y and sits a hair proud of the frame on Z
  // so the tinted face is always visible from either side.
  const canvasGeo = new THREE.BoxGeometry(
    BASE_WIDTH * 0.82,
    BASE_HEIGHT * 0.78,
    FRAME_THICKNESS * 1.1,
  );
  canvasGeo.translate(0, BASE_HEIGHT * 0.5, 0);
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
    _quat.identity();
    let i = 0;
    for (const { components } of world.query(['Painting', 'TileAnchor', 'PaintingViz'])) {
      if (i >= capacity) break;
      const a = components.TileAnchor;
      const p = components.Painting;
      const size = Math.max(1, p.size | 0);
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      // Size scales width more than height so a huge painting reads "wide".
      const scaleX = 1 + (size - 1) * 0.45;
      const scaleY = 1 + (size - 1) * 0.2;
      _scale.set(scaleX, scaleY, 1);
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      frameMesh.setMatrixAt(i, _matrix);
      canvasMesh.setMatrixAt(i, _matrix);
      const palette = Array.isArray(p.palette) ? p.palette : [];
      const hex = palette[2] ?? palette[palette.length - 1] ?? '#e6d4a8';
      _color.set(hex);
      canvasMesh.setColorAt(i, _color);
      i++;
    }
    frameMesh.count = i;
    canvasMesh.count = i;
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
