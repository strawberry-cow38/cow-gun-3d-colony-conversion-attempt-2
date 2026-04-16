/**
 * Floor render: one thin InstancedMesh per tile with a finished floor. Each
 * instance is a TILE_SIZE × FLOOR_THICKNESS × TILE_SIZE box sitting flush
 * with the tile's elevation — deep enough to hide seams against the terrain
 * without pushing above ground into the cow's feet.
 *
 * Per-instance color comes from the Floor entity's `stuff` field so a stone
 * floor and a wood floor read distinctly even on the same tile run.
 *
 * Floors under walls are skipped during update — a wall fully covers the
 * ground plane and the slab would only Z-fight with the wall base. Doors
 * stay transparent: cows walk through them and the floor reads correctly.
 * Wall build + demolish already trip `markDirty` via onWorldBuildComplete,
 * so the floor reappears when the wall falls.
 */

import * as THREE from 'three';
import { TILE_SIZE, tileToWorld } from '../world/coords.js';
import { getStuff } from '../world/stuff.js';

// Thin slab so floors look like a finished surface without poking into the
// cow silhouette. Lifted (BASE_LIFT) so the slab's bottom face never
// coincides with the terrain polygon beneath it — at 0.1u (~3mm) the depth
// buffer loses precision at RTS zoom-out and we'd see stripes of flicker.
// 2.0u ≈ 7cm real-world; plenty of separation at any supported zoom.
const FLOOR_THICKNESS = 1;
const BASE_LIFT = 2.0;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(TILE_SIZE, FLOOR_THICKNESS, TILE_SIZE);
const _color = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createFloorInstancer(scene, capacity = 4096) {
  // Unit box with its base on Y=0 so per-instance positioning places the
  // slab's bottom at the tile elevation.
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  const priming = new THREE.Color(1, 1, 1);
  mesh.setColorAt(0, priming);
  scene.add(mesh);

  _quat.identity();
  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let k = 0;
    for (const { components } of world.query(['Floor', 'TileAnchor', 'FloorViz'])) {
      if (k >= capacity) break;
      const a = components.TileAnchor;
      if (grid.isWall(a.i, a.j)) continue;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j) + BASE_LIFT;
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(k, _matrix);
      _color.setHex(getStuff(components.Floor.stuff).floorColor);
      mesh.setColorAt(k, _color);
      k++;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  /** @param {boolean} v */
  function setVisible(v) {
    mesh.visible = v;
  }

  return { mesh, update, markDirty, setVisible };
}
