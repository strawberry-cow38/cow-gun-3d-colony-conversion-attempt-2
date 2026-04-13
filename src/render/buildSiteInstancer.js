/**
 * BuildSite render: translucent blueprint frames for designated-but-unbuilt
 * walls. Height grows with `delivered / required` so players can see how much
 * material has arrived, and shifts to a warmer tint once a builder has started
 * hammering (`progress > 0`). Per-frame updates are cheap — site count stays
 * small in practice.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const FRAME_HEIGHT = 1.6 * UNITS_PER_METER;
const FRAME_WIDTH = TILE_SIZE * 0.9;
const FRAME_DEPTH = TILE_SIZE * 0.9;
const MIN_DELIVERED_FRAC = 0.15;

const COLOR_WAITING = new THREE.Color(0x9ad0ff);
const COLOR_BUILDING = new THREE.Color(0xffd080);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createBuildSiteInstancer(scene, capacity = 1024) {
  const geo = new THREE.BoxGeometry(FRAME_WIDTH, FRAME_HEIGHT, FRAME_DEPTH);
  geo.translate(0, FRAME_HEIGHT * 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
    transparent: true,
    opacity: 0.45,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  let dirty = true;
  // The instancer runs every frame for visual updates (progress tint), but we
  // only rebuild the matrix buffer when site topology changes.
  let topologyDirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    let i = 0;
    _quat.identity();
    for (const { components } of world.query(['BuildSite', 'TileAnchor', 'BuildSiteViz'])) {
      if (i >= capacity) break;
      const site = components.BuildSite;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      const deliveredFrac = Math.min(1, site.delivered / Math.max(1, site.required));
      const yScale = MIN_DELIVERED_FRAC + (1 - MIN_DELIVERED_FRAC) * deliveredFrac;
      _scale.set(1, yScale, 1);
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(i, _matrix);
      // Warmer hue while a builder is actively hammering (progress > 0),
      // cooler while the site sits waiting for materials or a free builder.
      const t = Math.min(1, site.progress);
      _color.copy(COLOR_WAITING).lerp(COLOR_BUILDING, t);
      mesh.setColorAt(i, _color);
      i++;
    }
    if (i !== mesh.count) topologyDirty = true;
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    dirty = false;
    topologyDirty = false;
  }

  function markDirty() {
    dirty = true;
    topologyDirty = true;
  }

  return { mesh, update, markDirty };
}
