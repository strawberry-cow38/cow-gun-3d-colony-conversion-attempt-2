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

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const HALF = TILE_SIZE * 0.5;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity per-face cap (so a wall-forest can still fit)
 */
export function createWallInstancer(scene, capacity = 2048) {
  const material = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, flatShading: true });

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
  for (const m of faces) {
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
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

    /** @type {{ i: number, j: number, y: number, cx: number, cz: number }[]} */
    const walls = [];
    const wallSet = new Set();
    for (const { components } of world.query(['Wall', 'TileAnchor', 'WallViz'])) {
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      walls.push({ i: a.i, j: a.j, y: grid.getElevation(a.i, a.j), cx: w.x, cz: w.z });
      wallSet.add(a.j * grid.W + a.i);
    }

    let ct = 0;
    let cpx = 0;
    let cnx = 0;
    let cpz = 0;
    let cnz = 0;
    for (const wall of walls) {
      const { i, j, y, cx, cz } = wall;
      const yMid = y + WALL_HEIGHT * 0.5;
      const yTop = y + WALL_HEIGHT;

      if (ct < capacity) {
        _position.set(cx, yTop, cz);
        _matrix.compose(_position, _quat, _scale);
        top.setMatrixAt(ct++, _matrix);
      }
      if (!wallSet.has(j * grid.W + (i + 1)) && cpx < capacity) {
        _position.set(cx + HALF, yMid, cz);
        _matrix.compose(_position, _quat, _scale);
        px.setMatrixAt(cpx++, _matrix);
      }
      if (!wallSet.has(j * grid.W + (i - 1)) && cnx < capacity) {
        _position.set(cx - HALF, yMid, cz);
        _matrix.compose(_position, _quat, _scale);
        nx.setMatrixAt(cnx++, _matrix);
      }
      if (!wallSet.has((j + 1) * grid.W + i) && cpz < capacity) {
        _position.set(cx, yMid, cz + HALF);
        _matrix.compose(_position, _quat, _scale);
        pz.setMatrixAt(cpz++, _matrix);
      }
      if (!wallSet.has((j - 1) * grid.W + i) && cnz < capacity) {
        _position.set(cx, yMid, cz - HALF);
        _matrix.compose(_position, _quat, _scale);
        nz.setMatrixAt(cnz++, _matrix);
      }
    }

    top.count = ct;
    px.count = cpx;
    nx.count = cnx;
    pz.count = cpz;
    nz.count = cnz;
    for (const m of faces) m.instanceMatrix.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { update, markDirty };
}
