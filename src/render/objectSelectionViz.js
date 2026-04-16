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
import { objectTypeFor } from '../ui/objectTypes.js';
import { BOULDER_VISUALS } from '../world/boulders.js';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { TREE_VISUALS, growthScale } from '../world/trees.js';

const SELECT_COLOR = 0xffe14a;
const DEMO_COLOR = 0xff3a3a;
const CAPACITY = 1024;

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const DOOR_HEIGHT = WALL_HEIGHT; // door frame fills to the top of the wall
const ROOF_THICKNESS = 4;
const FLOOR_THICKNESS = 1;
const TORCH_TOTAL_HEIGHT = (1.6 + 0.5) * UNITS_PER_METER; // stick + flame
const TRUNK_HEIGHT_M = 2.2;
const CONE_CANOPY_HEIGHT_M = 1.6;
const SPHERE_CANOPY_HEIGHT_M = 1.8; // 2 * 0.9m radius
const TRUNK_RADIUS_M = 0.18;
const CANOPY_RADIUS_M = 0.9;
const BOULDER_RADIUS_M = 0.55;
const BOULDER_HEIGHT_M = 0.9;
const TORCH_RADIUS_M = 0.22;

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
      const entry = objectTypeFor(world, id);
      if (!entry) return;
      const box = boxFor(entry, world, id);
      if (!box) return;
      const center = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const yBase = grid.getElevation(anchor.i, anchor.j) + box.yBase;
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
 * @param {import('../ui/objectTypes.js').ObjectType} entry
 * @param {import('../ecs/world.js').World} world
 * @param {number} id
 * @returns {{ w: number, h: number, d: number, yBase: number } | null}
 */
function boxFor(entry, world, id) {
  switch (entry.type) {
    case 'tree': {
      const tree = world.get(id, 'Tree');
      if (!tree) return null;
      const v = TREE_VISUALS[tree.kind] ?? TREE_VISUALS.oak;
      const g = growthScale(tree.growth);
      const canopyH = v.canopyShape === 'sphere' ? SPHERE_CANOPY_HEIGHT_M : CONE_CANOPY_HEIGHT_M;
      const h =
        (TRUNK_HEIGHT_M * v.trunkScale[1] + canopyH * v.canopyScale[1]) * g * UNITS_PER_METER;
      const radiusM = Math.max(
        TRUNK_RADIUS_M * Math.max(v.trunkScale[0], v.trunkScale[2]),
        CANOPY_RADIUS_M * Math.max(v.canopyScale[0], v.canopyScale[2]),
      );
      const side = 2 * radiusM * g * UNITS_PER_METER;
      return { w: side, h, d: side, yBase: 0 };
    }
    case 'boulder': {
      const b = world.get(id, 'Boulder');
      const v = (b && BOULDER_VISUALS[b.kind]) ?? BOULDER_VISUALS.stone;
      const side = 2 * BOULDER_RADIUS_M * Math.max(v.scale[0], v.scale[2]) * UNITS_PER_METER;
      const h = BOULDER_HEIGHT_M * v.scale[1] * UNITS_PER_METER;
      return { w: side, h, d: side, yBase: 0 };
    }
    case 'wall':
      return { w: TILE_SIZE, h: WALL_HEIGHT, d: TILE_SIZE, yBase: 0 };
    case 'door':
      return { w: TILE_SIZE, h: DOOR_HEIGHT, d: TILE_SIZE, yBase: 0 };
    case 'torch': {
      const t = world.get(id, 'Torch');
      const baseY = t?.wallMounted ? 1.8 * UNITS_PER_METER : 0;
      const side = 2 * TORCH_RADIUS_M * UNITS_PER_METER;
      return { w: side, h: TORCH_TOTAL_HEIGHT, d: side, yBase: baseY };
    }
    case 'roof':
      return { w: TILE_SIZE, h: ROOF_THICKNESS, d: TILE_SIZE, yBase: WALL_HEIGHT };
    case 'floor':
      return { w: TILE_SIZE, h: FLOOR_THICKNESS, d: TILE_SIZE, yBase: 0 };
    default:
      return null;
  }
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
