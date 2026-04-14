/**
 * Roof render: one flat InstancedMesh sitting at wall-top height (3m). Each
 * roof tile is a TILE_SIZE square quad, the same footprint as a door's top
 * frame, so roofs slot neatly atop wall runs.
 *
 * "Material copy": each instance picks its color from what's underneath — the
 * wall it sits on if any, else the roof color of an orthogonal neighbor roof,
 * else the tile biome. Walls are currently one shared brown, so for most
 * scenes this reads as uniform brown; the per-instance color path is in place
 * so once walls carry their own material it lights up without plumbing.
 *
 * Dirty flag toggles on wall/door/roof build + deconstruct via the shared
 * onWorldBuildComplete path. Debug-toggle `setVisible(false)` hides roofs so
 * the player can inspect what's underneath.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { BIOME } from '../world/tileGrid.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const ROOF_CLEARANCE = 0.02 * UNITS_PER_METER;
const WALL_COLOR = 0x8a5a2b;
const BIOME_ROOF_COLOR = /** @type {Record<number, number>} */ ({
  [BIOME.GRASS]: 0x5a7a4a,
  [BIOME.DIRT]: 0x7a5a3a,
  [BIOME.STONE]: 0x7a7a7a,
  [BIOME.SAND]: 0xc0a880,
});

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ');
const _scale = new THREE.Vector3(TILE_SIZE, TILE_SIZE, 1);
const _color = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createRoofInstancer(scene, capacity = 4096) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  // Prime instance-color buffer so THREE allocates it before first render.
  const priming = new THREE.Color(1, 1, 1);
  mesh.setColorAt(0, priming);
  scene.add(mesh);

  _quat.setFromEuler(_euler);
  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let k = 0;
    for (const { components } of world.query(['Roof', 'TileAnchor', 'RoofViz'])) {
      if (k >= capacity) break;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j) + WALL_HEIGHT + ROOF_CLEARANCE;
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(k, _matrix);
      _color.setHex(pickRoofColor(grid, a.i, a.j));
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

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 */
function pickRoofColor(grid, i, j) {
  if (grid.isWall(i, j)) return WALL_COLOR;
  const orthoNbrs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [di, dj] of orthoNbrs) {
    const ni = i + di;
    const nj = j + dj;
    if (!grid.inBounds(ni, nj)) continue;
    if (grid.isWall(ni, nj)) return WALL_COLOR;
  }
  return BIOME_ROOF_COLOR[grid.getBiome(i, j)] ?? WALL_COLOR;
}
