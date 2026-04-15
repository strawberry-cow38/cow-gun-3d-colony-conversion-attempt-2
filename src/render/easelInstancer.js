/**
 * Easel renderer. An easel is a tripod of three slim wooden posts leaning
 * together at the top, with a rectangular canvas frame hanging on the front.
 * Instanced per-Easel entity; facing rotates the whole group so the canvas
 * faces the work-spot tile.
 *
 * Ghost (placement preview) is deferred — the work-spot preview handled by
 * the build designator is enough feedback for a first pass.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { FACING_YAWS } from '../world/facing.js';

const FOOTPRINT = TILE_SIZE * 0.7;
const EASEL_HEIGHT = 1.6 * UNITS_PER_METER;
const POST_WIDTH = 0.04 * UNITS_PER_METER;
const CANVAS_WIDTH = TILE_SIZE * 0.62;
const CANVAS_HEIGHT = 0.7 * UNITS_PER_METER;
const CANVAS_DEPTH = 0.04 * UNITS_PER_METER;
const CANVAS_Y = 0.9 * UNITS_PER_METER;
const CANVAS_FRONT_OFFSET = FOOTPRINT * 0.22;

const WOOD_COLOR = 0x6b4a28;
const CANVAS_COLOR = 0xe6d4a8;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _forward = new THREE.Vector3();

/**
 * @param {THREE.Scene} scene
 * @param {number} [capacity]
 */
export function createEaselInstancer(scene, capacity = 32) {
  // One tall "trunk" post stands in for the tripod — cheap geometry, reads as
  // an easel at gameplay viewing distance. Canvas frame sits in front of it.
  const postGeo = new THREE.BoxGeometry(POST_WIDTH, EASEL_HEIGHT, POST_WIDTH);
  postGeo.translate(0, EASEL_HEIGHT * 0.5, 0);
  const postMat = new THREE.MeshStandardMaterial({
    color: WOOD_COLOR,
    roughness: 0.9,
    metalness: 0.02,
  });
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, capacity);
  postMesh.count = 0;
  postMesh.frustumCulled = false;
  postMesh.castShadow = true;
  postMesh.receiveShadow = true;
  scene.add(postMesh);

  const canvasGeo = new THREE.BoxGeometry(CANVAS_WIDTH, CANVAS_HEIGHT, CANVAS_DEPTH);
  const canvasMat = new THREE.MeshStandardMaterial({
    color: CANVAS_COLOR,
    roughness: 0.7,
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
    _scale.set(1, 1, 1);
    let i = 0;
    for (const { components } of world.query(['Easel', 'TileAnchor', 'EaselViz'])) {
      if (i >= capacity) break;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      const facing = components.Easel.facing | 0;
      const yaw = FACING_YAWS[facing] ?? 0;
      _quat.setFromAxisAngle(_yAxis, yaw);

      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      postMesh.setMatrixAt(i, _matrix);

      _forward.set(0, 0, 1).applyQuaternion(_quat);
      _position.set(
        w.x + _forward.x * CANVAS_FRONT_OFFSET,
        y + CANVAS_Y,
        w.z + _forward.z * CANVAS_FRONT_OFFSET,
      );
      _matrix.compose(_position, _quat, _scale);
      canvasMesh.setMatrixAt(i, _matrix);
      i++;
    }
    postMesh.count = i;
    canvasMesh.count = i;
    postMesh.instanceMatrix.needsUpdate = true;
    canvasMesh.instanceMatrix.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { postMesh, canvasMesh, update, markDirty };
}
