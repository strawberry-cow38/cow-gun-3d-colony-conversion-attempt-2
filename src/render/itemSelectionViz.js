/**
 * Per-item-stack world-space overlays:
 *   - yellow square outline under each selected stack
 *   - red X above each forbidden stack
 *
 * Both live as single LineSegments with pooled vertex buffers so adding/
 * removing highlights is just a needsUpdate+setDrawRange flip — no churn
 * on the scene graph.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const SELECT_COLOR = 0xffe14a;
const FORBID_COLOR = 0xff3a3a;

const SELECT_RADIUS = TILE_SIZE * 0.42;
const SELECT_Y_OFFSET = 0.08 * UNITS_PER_METER;
const SELECT_CAPACITY = 2048;

const FORBID_HALF = 0.32 * UNITS_PER_METER;
const FORBID_Y_OFFSET = 1.25 * UNITS_PER_METER;
const FORBID_CAPACITY = 2048;

/** @param {THREE.Scene} scene */
export function createItemSelectionViz(scene) {
  const selectGeo = new THREE.BufferGeometry();
  const selectPositions = new Float32Array(SELECT_CAPACITY * 8 * 3);
  selectGeo.setAttribute('position', new THREE.BufferAttribute(selectPositions, 3));
  selectGeo.setDrawRange(0, 0);
  const selectMat = new THREE.LineBasicMaterial({
    color: SELECT_COLOR,
    depthTest: false,
    transparent: true,
  });
  const selectLines = new THREE.LineSegments(selectGeo, selectMat);
  selectLines.frustumCulled = false;
  selectLines.renderOrder = 999;
  scene.add(selectLines);

  const forbidGeo = new THREE.BufferGeometry();
  const forbidPositions = new Float32Array(FORBID_CAPACITY * 4 * 3);
  forbidGeo.setAttribute('position', new THREE.BufferAttribute(forbidPositions, 3));
  forbidGeo.setDrawRange(0, 0);
  const forbidMat = new THREE.LineBasicMaterial({
    color: FORBID_COLOR,
    depthTest: false,
    transparent: true,
  });
  const forbidLines = new THREE.LineSegments(forbidGeo, forbidMat);
  forbidLines.frustumCulled = false;
  forbidLines.renderOrder = 1000;
  scene.add(forbidLines);

  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {Set<number>} selectedItems
   */
  function update(world, grid, selectedItems) {
    if (!dirty) return;
    let sel = 0;
    let fob = 0;
    for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
      const a = components.TileAnchor;
      const item = components.Item;
      const sw = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);

      if (selectedItems.has(id) && sel < SELECT_CAPACITY) {
        writeSquare(selectPositions, sel * 8 * 3, sw.x, y + SELECT_Y_OFFSET, sw.z, SELECT_RADIUS);
        sel++;
      }
      if (item.forbidden === true && fob < FORBID_CAPACITY) {
        writeCross(forbidPositions, fob * 4 * 3, sw.x, y + FORBID_Y_OFFSET, sw.z, FORBID_HALF);
        fob++;
      }
    }

    selectGeo.attributes.position.needsUpdate = true;
    selectGeo.setDrawRange(0, sel * 8);
    selectLines.visible = sel > 0;

    forbidGeo.attributes.position.needsUpdate = true;
    forbidGeo.setDrawRange(0, fob * 4);
    forbidLines.visible = fob > 0;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { update, markDirty };
}

/**
 * @param {Float32Array} out @param {number} off
 * @param {number} x @param {number} y @param {number} z @param {number} r
 */
function writeSquare(out, off, x, y, z, r) {
  const x0 = x - r;
  const x1 = x + r;
  const z0 = z - r;
  const z1 = z + r;
  let p = off;
  // N edge
  out[p++] = x0;
  out[p++] = y;
  out[p++] = z0;
  out[p++] = x1;
  out[p++] = y;
  out[p++] = z0;
  // E edge
  out[p++] = x1;
  out[p++] = y;
  out[p++] = z0;
  out[p++] = x1;
  out[p++] = y;
  out[p++] = z1;
  // S edge
  out[p++] = x1;
  out[p++] = y;
  out[p++] = z1;
  out[p++] = x0;
  out[p++] = y;
  out[p++] = z1;
  // W edge
  out[p++] = x0;
  out[p++] = y;
  out[p++] = z1;
  out[p++] = x0;
  out[p++] = y;
  out[p++] = z0;
}

/**
 * @param {Float32Array} out @param {number} off
 * @param {number} cx @param {number} cy @param {number} cz @param {number} h
 */
function writeCross(out, off, cx, cy, cz, h) {
  let p = off;
  // X standing upright on the XY plane, so it reads as an X from the
  // RTS oblique camera at any yaw (rather than collapsing when viewed
  // flat from above).
  out[p++] = cx - h;
  out[p++] = cy - h;
  out[p++] = cz;
  out[p++] = cx + h;
  out[p++] = cy + h;
  out[p++] = cz;
  out[p++] = cx - h;
  out[p++] = cy + h;
  out[p++] = cz;
  out[p++] = cx + h;
  out[p++] = cy - h;
  out[p++] = cz;
}
