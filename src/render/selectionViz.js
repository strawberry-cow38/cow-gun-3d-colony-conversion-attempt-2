/**
 * Per-cow selection overlays: a floating wireframe arrow above each selected
 * cow and two path previews (cyan next-step + amber full remaining path),
 * plus pink diamond markers at every pending waypoint.
 *
 * Multi-select uses a pool of slots that grows on demand; unused slots are
 * hidden in place so we don't churn GPU allocations as selection changes.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const ARROW_COLOR = 0xffe14a;
const NEXT_LINE_COLOR = 0x4ac0ff;
const FULL_PATH_COLOR = 0xffa14a;
const WAYPOINT_COLOR = 0xff4ac0;
// Sized for a max-octile path on a 200×200 grid with headroom.
const PATH_LINE_CAPACITY = 1024;
const WAYPOINT_CAPACITY = 64;
const WAYPOINT_RADIUS = TILE_SIZE * 0.35;
const LINE_GROUND_CLEARANCE = 0.1 * UNITS_PER_METER;
const WAYPOINT_CLEARANCE = 0.2 * UNITS_PER_METER;
const ARROW_HEAD_HEIGHT = 0.35 * UNITS_PER_METER;
const ARROW_HEAD_RADIUS = 0.18 * UNITS_PER_METER;
const ARROW_STEM_HEIGHT = 0.35 * UNITS_PER_METER;
const ARROW_STEM_RADIUS = 0.05 * UNITS_PER_METER;
const ARROW_HOVER_OFFSET = 2.3 * UNITS_PER_METER;
const ARROW_BOB_AMPLITUDE = 0.12 * UNITS_PER_METER;
const ARROW_BOB_FREQ_HZ = 1.2;
const ARROW_SPIN_SPEED = Math.PI * 0.8;

/**
 * @typedef Slot
 * @property {THREE.Group} arrow
 * @property {THREE.Line} nextLine
 * @property {THREE.BufferGeometry} nextGeo
 * @property {Float32Array} nextPositions
 * @property {THREE.Line} fullLine
 * @property {THREE.BufferGeometry} fullGeo
 * @property {Float32Array} fullPositions
 * @property {THREE.LineSegments} wpLines
 * @property {THREE.BufferGeometry} wpGeo
 * @property {Float32Array} wpPositions
 */

/**
 * @param {THREE.Scene} scene
 */
export function createSelectionViz(scene) {
  /** @type {Slot[]} */
  const pool = [];

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {Iterable<number>} selectedCows
   * @param {number} alpha
   * @param {number} timeSec
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, selectedCows, alpha, timeSec, grid) {
    let n = 0;
    for (const id of selectedCows) {
      const pos = world.get(id, 'Position');
      const prev = world.get(id, 'PrevPosition');
      if (!pos || !prev) continue;
      const slot = getSlot(scene, pool, n);
      updateSlot(slot, world, id, pos, prev, alpha, timeSec, grid);
      n++;
    }
    // Hide any leftover slots from previous frames.
    for (let i = n; i < pool.length; i++) hideSlot(pool[i]);
  }

  return { update };
}

/**
 * @param {THREE.Scene} scene @param {Slot[]} pool @param {number} i
 */
function getSlot(scene, pool, i) {
  while (pool.length <= i) pool.push(createSlot(scene));
  return pool[i];
}

/**
 * @param {THREE.Scene} scene
 * @returns {Slot}
 */
function createSlot(scene) {
  const arrow = buildArrow();
  arrow.visible = false;
  scene.add(arrow);

  const nextGeo = new THREE.BufferGeometry();
  const nextPositions = new Float32Array(6);
  nextGeo.setAttribute('position', new THREE.BufferAttribute(nextPositions, 3));
  const nextLine = new THREE.Line(nextGeo, new THREE.LineBasicMaterial({ color: NEXT_LINE_COLOR }));
  nextLine.frustumCulled = false;
  nextLine.visible = false;
  scene.add(nextLine);

  const fullGeo = new THREE.BufferGeometry();
  const fullPositions = new Float32Array(PATH_LINE_CAPACITY * 3);
  fullGeo.setAttribute('position', new THREE.BufferAttribute(fullPositions, 3));
  fullGeo.setDrawRange(0, 0);
  const fullLine = new THREE.Line(fullGeo, new THREE.LineBasicMaterial({ color: FULL_PATH_COLOR }));
  fullLine.frustumCulled = false;
  fullLine.visible = false;
  scene.add(fullLine);

  const wpGeo = new THREE.BufferGeometry();
  const wpPositions = new Float32Array(WAYPOINT_CAPACITY * 8 * 3);
  wpGeo.setAttribute('position', new THREE.BufferAttribute(wpPositions, 3));
  wpGeo.setDrawRange(0, 0);
  const wpLines = new THREE.LineSegments(
    wpGeo,
    new THREE.LineBasicMaterial({ color: WAYPOINT_COLOR }),
  );
  wpLines.frustumCulled = false;
  wpLines.visible = false;
  scene.add(wpLines);

  return {
    arrow,
    nextLine,
    nextGeo,
    nextPositions,
    fullLine,
    fullGeo,
    fullPositions,
    wpLines,
    wpGeo,
    wpPositions,
  };
}

/** @param {Slot} slot */
function hideSlot(slot) {
  slot.arrow.visible = false;
  slot.nextLine.visible = false;
  slot.fullLine.visible = false;
  slot.wpLines.visible = false;
}

/**
 * @param {Slot} slot
 * @param {import('../ecs/world.js').World} world
 * @param {number} id
 * @param {{x:number,y:number,z:number}} pos
 * @param {{x:number,y:number,z:number}} prev
 * @param {number} alpha @param {number} timeSec
 * @param {import('../world/tileGrid.js').TileGrid} grid
 */
function updateSlot(slot, world, id, pos, prev, alpha, timeSec, grid) {
  const x = prev.x + (pos.x - prev.x) * alpha;
  const y = prev.y + (pos.y - prev.y) * alpha;
  const z = prev.z + (pos.z - prev.z) * alpha;

  const bob = Math.sin(timeSec * ARROW_BOB_FREQ_HZ * Math.PI * 2) * ARROW_BOB_AMPLITUDE;
  slot.arrow.position.set(x, y + ARROW_HOVER_OFFSET + bob, z);
  slot.arrow.rotation.y = timeSec * ARROW_SPIN_SPEED;
  slot.arrow.visible = true;

  const job = world.get(id, 'Job');
  const waypoints = /** @type {{i:number,j:number}[]} */ (job?.payload?.waypoints ?? []);
  const wpCount = Math.min(waypoints.length, WAYPOINT_CAPACITY);
  for (let k = 0; k < wpCount; k++) {
    const wp = waypoints[k];
    const tw = tileToWorld(wp.i, wp.j, grid.W, grid.H);
    const wy = grid.getElevation(wp.i, wp.j) + WAYPOINT_CLEARANCE;
    const off = k * 8 * 3;
    const E = [tw.x + WAYPOINT_RADIUS, wy, tw.z];
    const N = [tw.x, wy, tw.z - WAYPOINT_RADIUS];
    const W_ = [tw.x - WAYPOINT_RADIUS, wy, tw.z];
    const S = [tw.x, wy, tw.z + WAYPOINT_RADIUS];
    writeSegment(slot.wpPositions, off, E, N);
    writeSegment(slot.wpPositions, off + 6, N, W_);
    writeSegment(slot.wpPositions, off + 12, W_, S);
    writeSegment(slot.wpPositions, off + 18, S, E);
  }
  slot.wpGeo.attributes.position.needsUpdate = true;
  slot.wpGeo.setDrawRange(0, wpCount * 8);
  slot.wpLines.visible = wpCount > 0;

  const path = world.get(id, 'Path');
  if (!path || path.index >= path.steps.length) {
    slot.nextLine.visible = false;
    slot.fullLine.visible = false;
    return;
  }
  const lineY = y + LINE_GROUND_CLEARANCE;

  const nextStep = path.steps[path.index];
  const nextTw = tileToWorld(nextStep.i, nextStep.j, grid.W, grid.H);
  slot.nextPositions[0] = x;
  slot.nextPositions[1] = lineY;
  slot.nextPositions[2] = z;
  slot.nextPositions[3] = nextTw.x;
  slot.nextPositions[4] = lineY;
  slot.nextPositions[5] = nextTw.z;
  slot.nextGeo.attributes.position.needsUpdate = true;
  slot.nextLine.visible = true;

  const remaining = path.steps.length - path.index;
  const vertexCount = Math.min(remaining, PATH_LINE_CAPACITY);
  for (let k = 0; k < vertexCount; k++) {
    const step = path.steps[path.index + k];
    const tw = tileToWorld(step.i, step.j, grid.W, grid.H);
    const off = k * 3;
    slot.fullPositions[off] = tw.x;
    slot.fullPositions[off + 1] = lineY;
    slot.fullPositions[off + 2] = tw.z;
  }
  slot.fullGeo.attributes.position.needsUpdate = true;
  slot.fullGeo.setDrawRange(0, vertexCount);
  slot.fullLine.visible = vertexCount >= 2;
}

/**
 * @param {Float32Array} out @param {number} off
 * @param {number[]} a @param {number[]} b
 */
function writeSegment(out, off, a, b) {
  out[off] = a[0];
  out[off + 1] = a[1];
  out[off + 2] = a[2];
  out[off + 3] = b[0];
  out[off + 4] = b[1];
  out[off + 5] = b[2];
}

function buildArrow() {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: ARROW_COLOR });

  const head = new THREE.EdgesGeometry(
    new THREE.ConeGeometry(ARROW_HEAD_RADIUS, ARROW_HEAD_HEIGHT, 6, 1, false),
  );
  const headLines = new THREE.LineSegments(head, mat);
  headLines.rotation.x = Math.PI;
  group.add(headLines);

  const stem = new THREE.EdgesGeometry(
    new THREE.CylinderGeometry(ARROW_STEM_RADIUS, ARROW_STEM_RADIUS, ARROW_STEM_HEIGHT, 6, 1),
  );
  const stemLines = new THREE.LineSegments(stem, mat);
  stemLines.position.y = ARROW_HEAD_HEIGHT * 0.5 + ARROW_STEM_HEIGHT * 0.5;
  group.add(stemLines);

  group.position.y = -ARROW_HEAD_HEIGHT * 0.5 - ARROW_STEM_HEIGHT * 0.5;

  group.traverse((obj) => {
    obj.frustumCulled = false;
  });
  return group;
}
