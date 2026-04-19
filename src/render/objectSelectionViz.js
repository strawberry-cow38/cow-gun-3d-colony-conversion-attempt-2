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
import { createBoxChannel, finalizeBoxChannel, writeBoxInstance } from './selectionBoxChannel.js';

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
  const yellow = createBoxChannel(scene, SELECT_COLOR, 998, CAPACITY);
  const red = createBoxChannel(scene, DEMO_COLOR, 999, CAPACITY);

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
        writeBoxInstance(red, nR++, _m);
      } else {
        if (nY >= CAPACITY) return;
        writeBoxInstance(yellow, nY++, _m);
      }
    };

    for (const id of demo) visit(id, true);
    for (const id of selected) {
      if (!demo.has(id)) visit(id, false);
    }

    finalizeBoxChannel(yellow, nY);
    finalizeBoxChannel(red, nR);
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
