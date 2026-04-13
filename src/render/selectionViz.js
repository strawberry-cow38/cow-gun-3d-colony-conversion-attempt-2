/**
 * Selection overlays: a floating wireframe arrow above the selected cow's
 * head plus two path previews.
 *
 * Arrow is built procedurally as wireframe LineSegments (head cone + stem)
 * pointing down at the cow. It bobs and spins for juice. Non-transparent —
 * uses depth-tested LineBasicMaterial so terrain occludes it correctly.
 *
 * Path previews:
 *   - `nextLine` (cyan)   → cow → next path tile only (Path.steps[Path.index]).
 *   - `fullLine` (amber)  → next tile → every remaining step. Sits slightly
 *                           below the next-line so the cyan stays readable
 *                           where they overlap.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const ARROW_COLOR = 0xffe14a;
const NEXT_LINE_COLOR = 0x4ac0ff;
const FULL_PATH_COLOR = 0xffa14a;
const PATH_LINE_CAPACITY = 4096; // plenty for any realistic path
const LINE_GROUND_CLEARANCE = 0.1 * UNITS_PER_METER;
const ARROW_HEAD_HEIGHT = 0.35 * UNITS_PER_METER;
const ARROW_HEAD_RADIUS = 0.18 * UNITS_PER_METER;
const ARROW_STEM_HEIGHT = 0.35 * UNITS_PER_METER;
const ARROW_STEM_RADIUS = 0.05 * UNITS_PER_METER;
const ARROW_HOVER_OFFSET = 1.6 * UNITS_PER_METER;
const ARROW_BOB_AMPLITUDE = 0.12 * UNITS_PER_METER;
const ARROW_BOB_FREQ_HZ = 1.2;
const ARROW_SPIN_SPEED = Math.PI * 0.8;

/**
 * @param {THREE.Scene} scene
 */
export function createSelectionViz(scene) {
  const arrow = buildArrow();
  arrow.visible = false;
  scene.add(arrow);

  // Cyan "next step" segment (cow → Path.steps[index]).
  const nextGeo = new THREE.BufferGeometry();
  const nextPositions = new Float32Array(6);
  nextGeo.setAttribute('position', new THREE.BufferAttribute(nextPositions, 3));
  const nextLine = new THREE.Line(nextGeo, new THREE.LineBasicMaterial({ color: NEXT_LINE_COLOR }));
  nextLine.frustumCulled = false;
  nextLine.visible = false;
  scene.add(nextLine);

  // Amber full-path polyline (next tile → every remaining step).
  const fullGeo = new THREE.BufferGeometry();
  const fullPositions = new Float32Array(PATH_LINE_CAPACITY * 3);
  fullGeo.setAttribute('position', new THREE.BufferAttribute(fullPositions, 3));
  fullGeo.setDrawRange(0, 0);
  const fullLine = new THREE.Line(fullGeo, new THREE.LineBasicMaterial({ color: FULL_PATH_COLOR }));
  fullLine.frustumCulled = false;
  fullLine.visible = false;
  scene.add(fullLine);

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {number | null} selectedCow
   * @param {number} alpha
   * @param {number} timeSec
   * @param {{ W: number, H: number }} grid
   */
  function update(world, selectedCow, alpha, timeSec, grid) {
    if (selectedCow === null) {
      arrow.visible = false;
      nextLine.visible = false;
      fullLine.visible = false;
      return;
    }
    const pos = world.get(selectedCow, 'Position');
    const prev = world.get(selectedCow, 'PrevPosition');
    if (!pos || !prev) {
      arrow.visible = false;
      nextLine.visible = false;
      fullLine.visible = false;
      return;
    }
    const x = prev.x + (pos.x - prev.x) * alpha;
    const y = prev.y + (pos.y - prev.y) * alpha;
    const z = prev.z + (pos.z - prev.z) * alpha;

    const bob = Math.sin(timeSec * ARROW_BOB_FREQ_HZ * Math.PI * 2) * ARROW_BOB_AMPLITUDE;
    arrow.position.set(x, y + ARROW_HOVER_OFFSET + bob, z);
    arrow.rotation.y = timeSec * ARROW_SPIN_SPEED;
    arrow.visible = true;

    const path = world.get(selectedCow, 'Path');
    if (!path || path.index >= path.steps.length) {
      nextLine.visible = false;
      fullLine.visible = false;
      return;
    }

    const lineY = y + LINE_GROUND_CLEARANCE;

    // Cyan: cow → next tile.
    const nextStep = path.steps[path.index];
    const nextTw = tileToWorld(nextStep.i, nextStep.j, grid.W, grid.H);
    nextPositions[0] = x;
    nextPositions[1] = lineY;
    nextPositions[2] = z;
    nextPositions[3] = nextTw.x;
    nextPositions[4] = lineY;
    nextPositions[5] = nextTw.z;
    nextGeo.attributes.position.needsUpdate = true;
    nextLine.visible = true;

    // Amber: polyline through every remaining step, starting at next tile so
    // we don't double-draw the cyan segment.
    const remaining = path.steps.length - path.index;
    const vertexCount = Math.min(remaining, PATH_LINE_CAPACITY);
    for (let n = 0; n < vertexCount; n++) {
      const step = path.steps[path.index + n];
      const tw = tileToWorld(step.i, step.j, grid.W, grid.H);
      const off = n * 3;
      fullPositions[off] = tw.x;
      fullPositions[off + 1] = lineY;
      fullPositions[off + 2] = tw.z;
    }
    fullGeo.attributes.position.needsUpdate = true;
    fullGeo.setDrawRange(0, vertexCount);
    fullLine.visible = vertexCount >= 2;
  }

  return { arrow, nextLine, fullLine, update };
}

function buildArrow() {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: ARROW_COLOR });

  // Arrow body is oriented to point DOWN (−Y). We build it with the tip at
  // y=0 and the stem extending up, then flip so the tip sits at −ARROW_HEAD_HEIGHT.
  // Head: cone edges — apex at (0, -headH, 0), base ring at y=0.
  const head = new THREE.EdgesGeometry(
    new THREE.ConeGeometry(ARROW_HEAD_RADIUS, ARROW_HEAD_HEIGHT, 6, 1, false),
  );
  const headLines = new THREE.LineSegments(head, mat);
  // ConeGeometry: apex at +y, base at -y. Rotate 180° on X so apex points down.
  headLines.rotation.x = Math.PI;
  group.add(headLines);

  // Stem: thin cylinder sitting above the head base.
  const stem = new THREE.EdgesGeometry(
    new THREE.CylinderGeometry(ARROW_STEM_RADIUS, ARROW_STEM_RADIUS, ARROW_STEM_HEIGHT, 6, 1),
  );
  const stemLines = new THREE.LineSegments(stem, mat);
  stemLines.position.y = ARROW_HEAD_HEIGHT * 0.5 + ARROW_STEM_HEIGHT * 0.5;
  group.add(stemLines);

  // Offset the whole arrow so the tip hangs just above the cow's head.
  group.position.y = -ARROW_HEAD_HEIGHT * 0.5 - ARROW_STEM_HEIGHT * 0.5;

  // Suppress frustum culling so it doesn't pop when near the edge of screen.
  group.traverse((obj) => {
    obj.frustumCulled = false;
  });
  return group;
}
