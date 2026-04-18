/**
 * Wall render: walls are split into five per-face InstancedMeshes (top + four
 * cardinal sides) instead of one box. When a side face's neighbor tile is also
 * a wall the face is occluded, so we skip emitting that instance — a run of N
 * walls in a line only draws (N*2 + 2) side faces instead of N*4. Bottom faces
 * are never emitted (ground-hugging).
 *
 * The GPU already backface-culls sides pointing away from the camera, so the
 * only thing left for CPU-side culling is this neighbor pass. Matrix buffers
 * rebuild on markDirty — build completion / wall removal.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { getStuff } from '../world/stuff.js';
import { LAYER_HEIGHT, WALL_FILL_FULL } from '../world/tileGrid.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const HALF = TILE_SIZE * 0.5;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity per-face cap (so a wall-forest can still fit)
 */
export function createWallInstancer(scene, capacity = 2048) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });

  // PlaneGeometry defaults to the XY plane facing +Z. Bake each face's
  // rotation into the geometry so per-instance matrices stay pure translations.
  const topGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE).rotateX(-Math.PI / 2);
  const pxGeo = new THREE.PlaneGeometry(TILE_SIZE, WALL_HEIGHT).rotateY(Math.PI / 2);
  const nxGeo = new THREE.PlaneGeometry(TILE_SIZE, WALL_HEIGHT).rotateY(-Math.PI / 2);
  const pzGeo = new THREE.PlaneGeometry(TILE_SIZE, WALL_HEIGHT);
  const nzGeo = new THREE.PlaneGeometry(TILE_SIZE, WALL_HEIGHT).rotateY(Math.PI);

  const top = new THREE.InstancedMesh(topGeo, material, capacity);
  const px = new THREE.InstancedMesh(pxGeo, material, capacity);
  const nx = new THREE.InstancedMesh(nxGeo, material, capacity);
  const pz = new THREE.InstancedMesh(pzGeo, material, capacity);
  const nz = new THREE.InstancedMesh(nzGeo, material, capacity);
  const faces = [top, px, nx, pz, nz];
  const priming = new THREE.Color(1, 1, 1);
  for (const m of faces) {
    m.count = 0;
    m.castShadow = true;
    m.receiveShadow = true;
    // Prime instance-color buffer so THREE allocates it before first render.
    m.setColorAt(0, priming);
    scene.add(m);
  }

  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    _quat.identity();
    _scale.set(1, 1, 1);

    const quarterH = WALL_HEIGHT / WALL_FILL_FULL;

    /** @type {{ i: number, j: number, z: number, fill: number, baseFill: number, y: number, cx: number, cz: number, color: number }[]} */
    const walls = [];
    // Per-tile top-reach keyed by (z, j, i) in quarter units. When a tile hosts
    // multiple Wall segments (partial + bigger tier placed atop) we track the
    // highest quarter reached so side-face occlusion compares against the full
    // stack, not just one segment.
    /** @type {Map<number, number>} */
    const wallTopAt = new Map();
    const stride = grid.W * grid.H;
    for (const { components } of world.query(['Wall', 'TileAnchor', 'WallViz'])) {
      const a = components.TileAnchor;
      const z = a.z | 0;
      const fill = Math.max(1, Math.min(WALL_FILL_FULL, components.Wall.fill | 0));
      const baseFill = Math.max(0, Math.min(WALL_FILL_FULL - 1, components.Wall.baseFill | 0));
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const color = getStuff(components.Wall.stuff).wallColor;
      const y = grid.getElevation(a.i, a.j) + z * LAYER_HEIGHT + baseFill * quarterH;
      walls.push({ i: a.i, j: a.j, z, fill, baseFill, y, cx: w.x, cz: w.z, color });
      const key = z * stride + a.j * grid.W + a.i;
      const topQ = baseFill + fill;
      const prev = wallTopAt.get(key) ?? 0;
      if (topQ > prev) wallTopAt.set(key, topQ);
    }

    let ct = 0;
    let cpx = 0;
    let cnx = 0;
    let cpz = 0;
    let cnz = 0;
    for (const wall of walls) {
      const { i, j, z, fill, baseFill, y, cx, cz, color } = wall;
      const h = fill * quarterH;
      const yMid = y + h * 0.5;
      const yTop = y + h;
      const base = z * stride;
      _color.setHex(color);
      const sideScaleY = fill / WALL_FILL_FULL;
      const segTop = baseFill + fill;

      if (ct < capacity) {
        _position.set(cx, yTop, cz);
        _scale.set(1, 1, 1);
        _matrix.compose(_position, _quat, _scale);
        top.setMatrixAt(ct, _matrix);
        top.setColorAt(ct, _color);
        ct++;
      }
      _scale.set(1, sideScaleY, 1);
      const neighborPx = wallTopAt.get(base + j * grid.W + (i + 1)) ?? 0;
      if (neighborPx < segTop && cpx < capacity) {
        _position.set(cx + HALF, yMid, cz);
        _matrix.compose(_position, _quat, _scale);
        px.setMatrixAt(cpx, _matrix);
        px.setColorAt(cpx, _color);
        cpx++;
      }
      const neighborNx = wallTopAt.get(base + j * grid.W + (i - 1)) ?? 0;
      if (neighborNx < segTop && cnx < capacity) {
        _position.set(cx - HALF, yMid, cz);
        _matrix.compose(_position, _quat, _scale);
        nx.setMatrixAt(cnx, _matrix);
        nx.setColorAt(cnx, _color);
        cnx++;
      }
      const neighborPz = wallTopAt.get(base + (j + 1) * grid.W + i) ?? 0;
      if (neighborPz < segTop && cpz < capacity) {
        _position.set(cx, yMid, cz + HALF);
        _matrix.compose(_position, _quat, _scale);
        pz.setMatrixAt(cpz, _matrix);
        pz.setColorAt(cpz, _color);
        cpz++;
      }
      const neighborNz = wallTopAt.get(base + (j - 1) * grid.W + i) ?? 0;
      if (neighborNz < segTop && cnz < capacity) {
        _position.set(cx, yMid, cz - HALF);
        _matrix.compose(_position, _quat, _scale);
        nz.setMatrixAt(cnz, _matrix);
        nz.setColorAt(cnz, _color);
        cnz++;
      }
    }

    top.count = ct;
    px.count = cpx;
    nx.count = cnx;
    pz.count = cpz;
    nz.count = cnz;
    for (const m of faces) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { update, markDirty };
}
