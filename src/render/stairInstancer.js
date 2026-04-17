/**
 * Stair renderer: 4 thick slabs per Stair entity — 3 step treads covering the
 * ramp tiles (rising a third of LAYER_HEIGHT each) and a top-landing slab at
 * full layer height.
 *
 * The pathfinder's ramp model lifts a cow a full layer in one tile, so the
 * stepped treads are purely visual — they read as a staircase even though the
 * cow's z actually snaps from 0 to LAYER_HEIGHT when it crosses the first
 * ramp tile. Good enough for an MVP; smooth-rise animation is a follow-up.
 */

import * as THREE from 'three';
import { TILE_SIZE, tileToWorld } from '../world/coords.js';
import { stairFootprintTiles } from '../world/stair.js';
import { getStuff } from '../world/stuff.js';
import { LAYER_HEIGHT } from '../world/tileGrid.js';

const TREAD_COUNT = 3;
const SLABS_PER_STAIR = TREAD_COUNT + 1;
const SLAB_THICKNESS = 2;
const STEP_RISE = LAYER_HEIGHT / TREAD_COUNT;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scaleStep = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} [capacity] max Stair entities (each consumes SLABS_PER_STAIR instance slots)
 */
export function createStairInstancer(scene, capacity = 128) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity * SLABS_PER_STAIR);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
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
    for (const { components } of world.query(['Stair', 'TileAnchor', 'StairViz'])) {
      if (k + SLABS_PER_STAIR > mesh.instanceMatrix.count) break;
      const a = components.TileAnchor;
      const facing = components.Stair.facing | 0;
      const baseY = grid.getElevation(a.i, a.j);
      const color = getStuff(components.Stair.stuff).floorColor;
      _color.setHex(color);
      const footprint = stairFootprintTiles(a, facing);
      // Slab 1-3: stepped treads on ramp tiles (rising STEP_RISE each).
      for (let n = 0; n < TREAD_COUNT; n++) {
        const t = footprint[n + 1];
        if (!grid.inBounds(t.i, t.j)) continue;
        const w = tileToWorld(t.i, t.j, grid.W, grid.H);
        const topY = baseY + STEP_RISE * (n + 1);
        _scaleStep.set(TILE_SIZE, topY - baseY, TILE_SIZE);
        _position.set(w.x, baseY, w.z);
        _matrix.compose(_position, _quat, _scaleStep);
        mesh.setMatrixAt(k, _matrix);
        mesh.setColorAt(k, _color);
        k++;
      }
      // Slab 4: top-landing floor at full layer height.
      const landing = footprint[footprint.length - 1];
      if (grid.inBounds(landing.i, landing.j)) {
        const w = tileToWorld(landing.i, landing.j, grid.W, grid.H);
        const topY = baseY + LAYER_HEIGHT;
        _scaleStep.set(TILE_SIZE, SLAB_THICKNESS, TILE_SIZE);
        _position.set(w.x, topY - SLAB_THICKNESS, w.z);
        _matrix.compose(_position, _quat, _scaleStep);
        mesh.setMatrixAt(k, _matrix);
        mesh.setColorAt(k, _color);
        k++;
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { mesh, update, markDirty };
}
