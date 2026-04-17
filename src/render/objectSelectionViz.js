/**
 * Translucent ghost boxes around world objects. Two classes:
 *   - yellow for entities in `state.selectedObjects`
 *   - red for entities currently marked for demolition (chop / mine /
 *     deconstruct), regardless of selection
 * Red wins when both apply, so demo status is always legible.
 *
 * Box dimensions come from `boxFor(entry, world, id)` — computed per-entity
 * so trees grow with their sapling scale and every built structure hugs its
 * actual geometry (walls are 3m, not 2.7m, etc.). Cheap to recompute since
 * we signature-cache on the id sets and only rebuild when something changes.
 */

import * as THREE from 'three';
import { tileToWorld } from '../world/coords.js';
import { LAYER_HEIGHT } from '../world/tileGrid.js';
import { boxForEntity } from './objectBox.js';

const SELECT_COLOR = 0xffe14a;
const DEMO_COLOR = 0xff3a3a;
const CAPACITY = 1024;

/**
 * Maps a Tree/Boulder/Wall/... entity to the component field that holds the
 * currently-active demolition job id. Non-zero = marked.
 *
 * @type {Record<string, string>}
 */
const DEMO_JOB_FIELD = {
  Tree: 'markedJobId',
  Boulder: 'markedJobId',
  Wall: 'deconstructJobId',
  Door: 'deconstructJobId',
  Torch: 'deconstructJobId',
  Roof: 'deconstructJobId',
  Floor: 'deconstructJobId',
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** @param {THREE.Scene} scene */
export function createObjectSelectionViz(scene) {
  const yellow = createBoxChannel(scene, SELECT_COLOR, 998);
  const red = createBoxChannel(scene, DEMO_COLOR, 999);

  let lastSig = '';

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {Set<number>} selected
   */
  function update(world, grid, selected) {
    const demo = collectDemoIds(world);
    let sig = `${selected.size}|`;
    for (const id of selected) sig += `${id},`;
    sig += `|${demo.size}|`;
    for (const id of demo) sig += `${id},`;
    if (sig === lastSig) return;
    lastSig = sig;

    let nY = 0;
    let nR = 0;
    const visit = (id, isDemo) => {
      const anchor = world.get(id, 'TileAnchor');
      if (!anchor) return;
      const box = boxForEntity(world, id);
      if (!box) return;
      const center = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const zLift = (anchor.z | 0) * LAYER_HEIGHT;
      const yBase = grid.getElevation(anchor.i, anchor.j) + zLift + box.yBase;
      _p.set(center.x, yBase + box.h * 0.5, center.z);
      _q.identity();
      _s.set(box.w, box.h, box.d);
      _m.compose(_p, _q, _s);
      if (isDemo) {
        if (nR >= CAPACITY) return;
        writeInstance(red, nR++, _m);
      } else {
        if (nY >= CAPACITY) return;
        writeInstance(yellow, nY++, _m);
      }
    };

    for (const id of demo) visit(id, true);
    for (const id of selected) {
      if (!demo.has(id)) visit(id, false);
    }

    finalizeChannel(yellow, nY);
    finalizeChannel(red, nR);
  }

  function markDirty() {
    lastSig = '';
  }

  return { update, markDirty };
}

/** @param {import('../ecs/world.js').World} world */
function collectDemoIds(world) {
  /** @type {Set<number>} */
  const ids = new Set();
  for (const comp of Object.keys(DEMO_JOB_FIELD)) {
    const field = DEMO_JOB_FIELD[comp];
    for (const { id, components } of world.query([comp])) {
      if (components[comp][field] > 0) ids.add(id);
    }
  }
  return ids;
}

/**
 * @typedef {Object} BoxChannel
 * @property {THREE.InstancedMesh} mesh
 * @property {THREE.LineSegments} edges
 * @property {THREE.BufferGeometry} edgeBuffer
 * @property {Float32Array} edgePositions
 * @property {Float32Array} edgeBasePositions
 * @property {number} edgeVertCount
 */

/**
 * @param {THREE.Scene} scene @param {number} color @param {number} renderOrder
 * @returns {BoxChannel}
 */
function createBoxChannel(scene, color, renderOrder) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  scene.add(mesh);

  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({
    color,
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
  edges.renderOrder = renderOrder + 1;
  scene.add(edges);

  return { mesh, edges, edgeBuffer, edgePositions, edgeBasePositions, edgeVertCount };
}

/** @param {BoxChannel} ch @param {number} idx @param {THREE.Matrix4} m */
function writeInstance(ch, idx, m) {
  ch.mesh.setMatrixAt(idx, m);
  writeEdges(ch.edgePositions, idx * ch.edgeVertCount * 3, ch.edgeBasePositions, m);
}

/** @param {BoxChannel} ch @param {number} count */
function finalizeChannel(ch, count) {
  ch.mesh.count = count;
  ch.mesh.instanceMatrix.needsUpdate = true;
  ch.mesh.visible = count > 0;
  ch.edgeBuffer.setDrawRange(0, count * ch.edgeVertCount);
  ch.edgeBuffer.attributes.position.needsUpdate = true;
  ch.edges.visible = count > 0;
}

/**
 * @param {Float32Array} out @param {number} off
 * @param {ArrayLike<number>} base @param {THREE.Matrix4} m
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
