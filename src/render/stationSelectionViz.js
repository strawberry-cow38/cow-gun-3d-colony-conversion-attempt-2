/**
 * Translucent yellow 3D ghost box around every selected crafting station.
 * Mirrors the box that objectSelectionViz draws around trees/walls/etc. so a
 * selected furnace/easel/stove feels the same as any other selected world
 * object — same affordance, same readability at distance.
 *
 * Stove is a 3x1 station: its box is rotated by the stove's `facing` so the
 * long edge aligns with the body span. Furnace/easel are anchored on a single
 * tile and don't need rotation.
 */

import * as THREE from 'three';
import { TILE_SIZE, tileToWorld } from '../world/coords.js';
import { FACING_OFFSETS, FACING_YAWS } from '../world/facing.js';
import { BED_HEADBOARD_HEIGHT, BED_LENGTH, BED_WIDTH } from './bedInstancer.js';
import { EASEL_FOOTPRINT, EASEL_HEIGHT } from './easelInstancer.js';
import { FURNACE_FOOTPRINT, FURNACE_HEIGHT } from './furnaceInstancer.js';
import { STOVE_BODY_DEPTH, STOVE_BODY_HEIGHT, STOVE_BODY_SPAN } from './stoveInstancer.js';

const SELECT_COLOR = 0xffe14a;
const CAPACITY = 64;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

/** @param {THREE.Scene} scene */
export function createStationSelectionViz(scene) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: SELECT_COLOR,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 998;
  scene.add(mesh);

  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({
    color: SELECT_COLOR,
    transparent: true,
    opacity: 0.7,
    depthTest: false,
  });
  const edgeBasePositions = /** @type {Float32Array} */ (edgeGeo.getAttribute('position').array);
  const edgeVertCount = edgeBasePositions.length / 3;
  const edgePositions = new Float32Array(CAPACITY * edgeVertCount * 3);
  const edgeBuffer = new THREE.BufferGeometry();
  edgeBuffer.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
  edgeBuffer.setDrawRange(0, 0);
  const edges = new THREE.LineSegments(edgeBuffer, edgeMat);
  edges.frustumCulled = false;
  edges.renderOrder = 999;
  scene.add(edges);

  // Cheap signature of the drawn selection + per-stove facing (the box
  // rotates with facing). Bill activity doesn't affect the outline, so we
  // don't need to resample every frame.
  let lastSig = '';

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {{
   *   selectedFurnaces: Set<number>,
   *   selectedEasels: Set<number>,
   *   selectedStoves: Set<number>,
   *   selectedBeds: Set<number>,
   * }} sel
   */
  function update(world, grid, sel) {
    let sig = '';
    for (const id of sel.selectedFurnaces) sig += `F${id},`;
    for (const id of sel.selectedEasels) sig += `E${id},`;
    for (const id of sel.selectedStoves) {
      const s = world.get(id, 'Stove');
      sig += `S${id}:${s?.facing ?? 0},`;
    }
    for (const id of sel.selectedBeds) {
      const b = world.get(id, 'Bed');
      sig += `B${id}:${b?.facing ?? 0},`;
    }
    if (sig === lastSig) return;
    lastSig = sig;

    let n = 0;
    n = writeSquares(world, grid, sel.selectedFurnaces, n, FURNACE_FOOTPRINT, FURNACE_HEIGHT);
    n = writeSquares(world, grid, sel.selectedEasels, n, EASEL_FOOTPRINT, EASEL_HEIGHT);
    n = writeStoves(world, grid, sel.selectedStoves, n);
    n = writeBeds(world, grid, sel.selectedBeds, n);

    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = n > 0;
    edgeBuffer.setDrawRange(0, n * edgeVertCount);
    edgeBuffer.attributes.position.needsUpdate = true;
    edges.visible = n > 0;
  }

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {Set<number>} selected
   * @param {number} startN
   * @param {number} footprint
   * @param {number} height
   */
  function writeSquares(world, grid, selected, startN, footprint, height) {
    let n = startN;
    for (const id of selected) {
      if (n >= CAPACITY) break;
      const a = world.get(id, 'TileAnchor');
      if (!a) continue;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const yBase = grid.getElevation(a.i, a.j);
      _p.set(w.x, yBase + height * 0.5, w.z);
      _q.identity();
      _s.set(footprint, height, footprint);
      _m.compose(_p, _q, _s);
      writeInstance(n, _m);
      n++;
    }
    return n;
  }

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {Set<number>} selected
   * @param {number} startN
   */
  function writeStoves(world, grid, selected, startN) {
    let n = startN;
    for (const id of selected) {
      if (n >= CAPACITY) break;
      const a = world.get(id, 'TileAnchor');
      const s = world.get(id, 'Stove');
      if (!a || !s) continue;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const yBase = grid.getElevation(a.i, a.j);
      _p.set(w.x, yBase + STOVE_BODY_HEIGHT * 0.5, w.z);
      // Rotate the box around Y so the long axis aligns with the body span
      // (perpendicular to `facing`). Uses the same yaw table the renderer uses.
      _q.setFromAxisAngle(_yAxis, FACING_YAWS[s.facing | 0] ?? 0);
      _s.set(STOVE_BODY_SPAN, STOVE_BODY_HEIGHT, STOVE_BODY_DEPTH);
      _m.compose(_p, _q, _s);
      writeInstance(n, _m);
      n++;
    }
    return n;
  }

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {Set<number>} selected
   * @param {number} startN
   */
  function writeBeds(world, grid, selected, startN) {
    let n = startN;
    for (const id of selected) {
      if (n >= CAPACITY) break;
      const a = world.get(id, 'TileAnchor');
      const b = world.get(id, 'Bed');
      if (!a || !b) continue;
      const anchor = tileToWorld(a.i, a.j, grid.W, grid.H);
      const off = FACING_OFFSETS[b.facing | 0] ?? FACING_OFFSETS[0];
      // Mattress center is half a tile forward from the anchor — match the
      // renderer so the box hugs the mattress rather than floating over the
      // foot tile.
      const cx = anchor.x + off.di * (TILE_SIZE / 2);
      const cz = anchor.z + off.dj * (TILE_SIZE / 2);
      const yBase = grid.getElevation(a.i, a.j);
      _p.set(cx, yBase + BED_HEADBOARD_HEIGHT * 0.5, cz);
      _q.setFromAxisAngle(_yAxis, FACING_YAWS[b.facing | 0] ?? 0);
      _s.set(BED_WIDTH, BED_HEADBOARD_HEIGHT, BED_LENGTH);
      _m.compose(_p, _q, _s);
      writeInstance(n, _m);
      n++;
    }
    return n;
  }

  /** @param {number} idx @param {THREE.Matrix4} m */
  function writeInstance(idx, m) {
    mesh.setMatrixAt(idx, m);
    writeEdges(edgePositions, idx * edgeVertCount * 3, edgeBasePositions, m);
  }

  return { update };
}

/**
 * @param {Float32Array} out
 * @param {number} off
 * @param {ArrayLike<number>} base
 * @param {THREE.Matrix4} m
 */
function writeEdges(out, off, base, m) {
  const e = m.elements;
  let p = off;
  for (let i = 0; i < base.length; i += 3) {
    const x = base[i];
    const y = base[i + 1];
    const z = base[i + 2];
    out[p++] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[p++] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[p++] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
}
