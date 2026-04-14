/**
 * Roof render: one flat InstancedMesh sitting at wall-top height (3m). Each
 * roof tile is a TILE_SIZE square quad, the same footprint as a door's top
 * frame, so roofs slot neatly atop wall runs.
 *
 * "Material copy": each roof tile takes WALL_COLOR if it's on/adjacent to a
 * wall OR transitively connected via roof neighbors to one that is — BFS from
 * wall-touching roofs propagates the wall color through the whole roof patch
 * so rooms appear roofed in a single material instead of only the outer ring
 * inheriting wall color and the interior falling back to grass.
 *
 * Dirty flag toggles on wall/door/roof build + deconstruct via the shared
 * onWorldBuildComplete path. Debug-toggle `setVisible(false)` hides roofs so
 * the player can inspect what's underneath.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { BIOME } from '../world/tileGrid.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
// Roofs are a thick slab resting on top of the walls — the base face of the
// slab meets the wall-top (no drop) and the slab extends upward by this much.
const ROOF_THICKNESS = 4;
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
    const wallColorMap = buildWallColorMap(world, grid);
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
      const hex = wallColorMap.has(idx)
        ? WALL_COLOR
        : (BIOME_ROOF_COLOR[grid.getBiome(a.i, a.j)] ?? WALL_COLOR);
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

const ORTHO = /** @type {const} */ ([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);

/**
 * Build the set of roof-tile indices that should render with WALL_COLOR.
 * Seed = roofs on or orthogonally adjacent to a wall; BFS expands along roof
 * neighbors so the whole connected roof patch inherits the wall color.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 */
function buildWallColorMap(world, grid) {
  /** @type {Set<number>} */
  const seeded = new Set();
  /** @type {number[]} */
  const frontier = [];
  for (const { components } of world.query(['Roof', 'TileAnchor'])) {
    const { i, j } = components.TileAnchor;
    const idx = grid.idx(i, j);
    if (!touchesWall(grid, i, j)) continue;
    seeded.add(idx);
    frontier.push(idx);
  }
  while (frontier.length > 0) {
    const k = /** @type {number} */ (frontier.pop());
    const i = k % grid.W;
    const j = (k - i) / grid.W;
    for (const [di, dj] of ORTHO) {
      const ni = i + di;
      const nj = j + dj;
      if (!grid.inBounds(ni, nj)) continue;
      if (!grid.isRoof(ni, nj)) continue;
      const nidx = grid.idx(ni, nj);
      if (seeded.has(nidx)) continue;
      seeded.add(nidx);
      frontier.push(nidx);
    }
  }
  return seeded;
}

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} i @param {number} j
 */
function touchesWall(grid, i, j) {
  if (grid.isWall(i, j)) return true;
  for (const [di, dj] of ORTHO) {
    const ni = i + di;
    const nj = j + dj;
    if (!grid.inBounds(ni, nj)) continue;
    if (grid.isWall(ni, nj)) return true;
  }
  return false;
}
