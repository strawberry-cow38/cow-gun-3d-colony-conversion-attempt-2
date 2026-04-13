/**
 * Wall render: one InstancedMesh of solid vertical wood blocks per built Wall
 * entity. Static — matrices rebuild only when the top-level `dirty` flag is
 * flipped by a build completion or a wall removal. Lower-effort visuals than
 * trees since a wall is just a tile-sized rectangular prism.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const WALL_WIDTH = TILE_SIZE;
const WALL_DEPTH = TILE_SIZE;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createWallInstancer(scene, capacity = 2048) {
  const geo = new THREE.BoxGeometry(WALL_WIDTH, WALL_HEIGHT, WALL_DEPTH);
  geo.translate(0, WALL_HEIGHT * 0.5, 0);
  // Sawn-wood brown — distinguishable from the tree trunk's redder tone so a
  // wall behind a tree still reads as a separate object.
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let i = 0;
    _quat.identity();
    _scale.set(1, 1, 1);
    for (const { components } of world.query(['Wall', 'TileAnchor', 'WallViz'])) {
      if (i >= capacity) break;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(i, _matrix);
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { mesh, update, markDirty };
}
