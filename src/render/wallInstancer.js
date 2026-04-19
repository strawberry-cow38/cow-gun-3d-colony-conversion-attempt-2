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

    /** @type {{ i: number, j: number, z: number, fill: number, y: number, cx: number, cz: number, color: number }[]} */
    const walls = [];
    // Per-wall fill keyed by (z, j, i) — occlusion skips a side face only when
    // the neighbor's fill is at least as tall as ours (full next to quarter
    // still needs its upper body drawn).
    /** @type {Map<number, number>} */
    const wallFillAt = new Map();
    const stride = grid.W * grid.H;
    for (const { components } of world.query(['Wall', 'TileAnchor', 'WallViz'])) {
      const a = components.TileAnchor;
      const z = a.z | 0;
      const fill = Math.max(1, Math.min(WALL_FILL_FULL, components.Wall.fill | 0));
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const color = getStuff(components.Wall.stuff).wallColor;
      const y = grid.getElevation(a.i, a.j) + z * LAYER_HEIGHT;
      walls.push({ i: a.i, j: a.j, z, fill, y, cx: w.x, cz: w.z, color });
      wallFillAt.set(z * stride + a.j * grid.W + a.i, fill);
    }

    const quarterH = WALL_HEIGHT / WALL_FILL_FULL;

    let ct = 0;
    let cpx = 0;
    let cnx = 0;
    let cpz = 0;
    let cnz = 0;
    for (const wall of walls) {
      const { i, j, z, fill, y, cx, cz, color } = wall;
      const h = fill * quarterH;
      const yMid = y + h * 0.5;
      const yTop = y + h;
      const base = z * stride;
      _color.setHex(color);
      const sideScaleY = fill / WALL_FILL_FULL;

      if (ct < capacity) {
        _position.set(cx, yTop, cz);
        _scale.set(1, 1, 1);
        _matrix.compose(_position, _quat, _scale);
        top.setMatrixAt(ct, _matrix);
        top.setColorAt(ct, _color);
        ct++;
      }
      _scale.set(1, sideScaleY, 1);
      const neighborPx = wallFillAt.get(base + j * grid.W + (i + 1)) ?? 0;
      if (neighborPx < fill && cpx < capacity) {
        _position.set(cx + HALF, yMid, cz);
        _matrix.compose(_position, _quat, _scale);
        px.setMatrixAt(cpx, _matrix);
        px.setColorAt(cpx, _color);
        cpx++;
      }
      const neighborNx = wallFillAt.get(base + j * grid.W + (i - 1)) ?? 0;
      if (neighborNx < fill && cnx < capacity) {
        _position.set(cx - HALF, yMid, cz);
        _matrix.compose(_position, _quat, _scale);
        nx.setMatrixAt(cnx, _matrix);
        nx.setColorAt(cnx, _color);
        cnx++;
      }
      const neighborPz = wallFillAt.get(base + (j + 1) * grid.W + i) ?? 0;
      if (neighborPz < fill && cpz < capacity) {
        _position.set(cx, yMid, cz + HALF);
        _matrix.compose(_position, _quat, _scale);
        pz.setMatrixAt(cpz, _matrix);
        pz.setColorAt(cpz, _color);
        cpz++;
      }
      const neighborNz = wallFillAt.get(base + (j - 1) * grid.W + i) ?? 0;
      if (neighborNz < fill && cnz < capacity) {
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

const QUARTER_HEIGHT = WALL_HEIGHT / WALL_FILL_FULL;
const _ghostMatrix = new THREE.Matrix4();
const _ghostPos = new THREE.Vector3();
const _ghostQuat = new THREE.Quaternion();
const _ghostScale = new THREE.Vector3();
const _ghostColor = new THREE.Color();

/**
 * Translucent box-instancer used by the wall designator to preview each cell
 * of a drag-rect at the right Y for its stack position. One InstancedMesh
 * shared across full/half/quarter — tier sets the Y-scale on each instance.
 *
 * @param {THREE.Scene} scene
 * @param {number} capacity max cells the ghost can preview at once.
 */
export function createWallGhost(scene, capacity = 1024) {
  const geo = new THREE.BoxGeometry(TILE_SIZE, QUARTER_HEIGHT, TILE_SIZE);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Prime instance-color buffer so per-instance colors take effect on first
  // render — same trick as the live wall instancer above.
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  scene.add(mesh);

  /**
   * Place one box per cell. Each cell's `baseFill` is in quarter units; the
   * ghost is anchored at `y + baseFill * QUARTER_HEIGHT` and scaled to the
   * tier's height. `tier` is in quarter units (1/2/4 for quarter/half/full).
   *
   * @param {{ cx: number, cz: number, y: number, baseFill: number }[]} cells
   * @param {number} tier
   * @param {number} colorHex
   */
  function setCells(cells, tier, colorHex) {
    _ghostQuat.identity();
    _ghostColor.setHex(colorHex);
    const tierH = tier * QUARTER_HEIGHT;
    const n = Math.min(cells.length, capacity);
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      const baseY = c.y + c.baseFill * QUARTER_HEIGHT;
      _ghostPos.set(c.cx, baseY + tierH * 0.5, c.cz);
      // Geometry is unit-quarter tall — scale Y by tier so a half-wall ghost
      // is twice as tall and a full-wall ghost four times.
      _ghostScale.set(1, tier, 1);
      _ghostMatrix.compose(_ghostPos, _ghostQuat, _ghostScale);
      mesh.setMatrixAt(k, _ghostMatrix);
      mesh.setColorAt(k, _ghostColor);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.visible = n > 0;
  }

  function hide() {
    mesh.count = 0;
    mesh.visible = false;
  }

  return { setCells, hide };
}
