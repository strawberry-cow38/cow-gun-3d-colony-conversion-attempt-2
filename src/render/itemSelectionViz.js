/**
 * Per-item-stack world-space overlays:
 *   - yellow translucent ghost box around each selected stack (sized by the
 *     stack's rendered footprint — wood tiers grow with pile size)
 *   - red X above each forbidden stack
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { footprintMeters } from './itemHitboxes.js';
import { createBoxChannel, finalizeBoxChannel, writeBoxInstance } from './selectionBoxChannel.js';

const SELECT_COLOR = 0xffe14a;
const FORBID_COLOR = 0xff3a3a;

const SELECT_CAPACITY = 1024;

const FORBID_HALF = 0.32 * UNITS_PER_METER;
const FORBID_Y_OFFSET = 1.25 * UNITS_PER_METER;
const FORBID_CAPACITY = 2048;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** @param {THREE.Scene} scene */
export function createItemSelectionViz(scene) {
  const selectCh = createBoxChannel(scene, SELECT_COLOR, 998, SELECT_CAPACITY);

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
    _q.identity();
    for (const { id, components } of world.query(['Item', 'TileAnchor'])) {
      const a = components.TileAnchor;
      const item = components.Item;
      const sw = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);

      if (selectedItems.has(id) && sel < SELECT_CAPACITY) {
        const fp = footprintMeters(item.kind, item.count, item.capacity);
        const w = fp.w * UNITS_PER_METER;
        const h = fp.h * UNITS_PER_METER;
        const d = fp.d * UNITS_PER_METER;
        _p.set(sw.x, y + h * 0.5, sw.z);
        _s.set(w, h, d);
        _m.compose(_p, _q, _s);
        writeBoxInstance(selectCh, sel, _m);
        sel++;
      }
      if (item.forbidden === true && fob < FORBID_CAPACITY) {
        writeCross(forbidPositions, fob * 4 * 3, sw.x, y + FORBID_Y_OFFSET, sw.z, FORBID_HALF);
        fob++;
      }
    }

    finalizeBoxChannel(selectCh, sel);

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
 * @param {number} cx @param {number} cy @param {number} cz @param {number} h
 */
function writeCross(out, off, cx, cy, cz, h) {
  let p = off;
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
