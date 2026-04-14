/**
 * Roof render: one flat InstancedMesh sitting at wall-top height (3m). Each
 * roof tile is a TILE_SIZE square quad, the same footprint as a door's top
 * frame, so roofs slot neatly atop wall runs.
 *
 * "Material copy": each roof tile takes WALL_COLOR if it's structurally
 * connected to a wall/door via findSupportedRoofTiles — so the whole roof
 * patch inherits wall color instead of only the outer ring, interior falling
 * back to biome color.
 *
 * Dirty flag toggles on wall/door/roof build + deconstruct via the shared
 * onWorldBuildComplete path. Debug-toggle `setVisible(false)` hides roofs so
 * the player can inspect what's underneath.
 */

import * as THREE from 'three';
import { findSupportedRoofTiles } from '../systems/autoRoof.js';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { getStuff } from '../world/stuff.js';
import { BIOME } from '../world/tileGrid.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
// Roofs are a thick slab resting on top of the walls — the base face of the
// slab meets the wall-top (no drop) and the slab extends upward by this much.
const ROOF_THICKNESS = 4;
const BIOME_ROOF_COLOR = /** @type {Record<number, number>} */ ({
  [BIOME.GRASS]: 0x5a7a4a,
  [BIOME.DIRT]: 0x7a5a3a,
  [BIOME.STONE]: 0x7a7a7a,
  [BIOME.SAND]: 0xc0a880,
});

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(TILE_SIZE, ROOF_THICKNESS, TILE_SIZE);
const _color = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createRoofInstancer(scene, capacity = 4096) {
  // Unit box with its base on Y=0 so per-instance positioning uses the
  // wall-top as the foot of the slab — no need to compensate for half-thickness.
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Prime instance-color buffer so THREE allocates it before first render.
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
    const supported = findSupportedRoofTiles(grid);
    let k = 0;
    for (const { components } of world.query(['Roof', 'TileAnchor', 'RoofViz'])) {
      if (k >= capacity) break;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j) + WALL_HEIGHT;
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(k, _matrix);
      const idx = grid.idx(a.i, a.j);
      const stuffColor = getStuff(components.Roof.stuff).roofColor;
      const hex = supported.has(idx)
        ? stuffColor
        : (BIOME_ROOF_COLOR[grid.getBiome(a.i, a.j)] ?? stuffColor);
      _color.setHex(hex);
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
