/**
 * Selection overlays: a floating wireframe arrow above the selected cow's
 * head and a line to her next path step.
 *
 * Arrow is built procedurally as wireframe LineSegments (head cone + stem)
 * pointing down at the cow. It bobs and spins for juice. Non-transparent —
 * uses depth-tested LineBasicMaterial so terrain occludes it correctly.
 *
 * Path preview is a single line segment from the cow's interpolated world
 * position to the world-space center of `Path.steps[Path.index]`.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const ARROW_COLOR = 0xffe14a;
const PATH_LINE_COLOR = 0x4ac0ff;
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

  const lineGeo = new THREE.BufferGeometry();
  const linePositions = new Float32Array(6);
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: PATH_LINE_COLOR });
  const pathLine = new THREE.Line(lineGeo, lineMat);
  pathLine.frustumCulled = false;
  pathLine.visible = false;
  scene.add(pathLine);

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
      pathLine.visible = false;
      return;
    }
    const pos = world.get(selectedCow, 'Position');
    const prev = world.get(selectedCow, 'PrevPosition');
    if (!pos || !prev) {
      arrow.visible = false;
      pathLine.visible = false;
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
    if (path && path.index < path.steps.length) {
      const step = path.steps[path.index];
      const tw = tileToWorld(step.i, step.j, grid.W, grid.H);
      linePositions[0] = x;
      linePositions[1] = y + 0.1 * UNITS_PER_METER;
      linePositions[2] = z;
      linePositions[3] = tw.x;
      linePositions[4] = y + 0.1 * UNITS_PER_METER;
      linePositions[5] = tw.z;
      lineGeo.attributes.position.needsUpdate = true;
      pathLine.visible = true;
    } else {
      pathLine.visible = false;
    }
  }

  return { arrow, pathLine, update };
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
