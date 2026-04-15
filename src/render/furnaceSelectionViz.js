/**
 * Yellow ring around every selected furnace's footprint tile. Single
 * LineSegments with a pooled vertex buffer — same shape as the item
 * selection ring, just wider and anchored on the furnace body tile.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { writeSquareOutline } from './selectionGeom.js';

const SELECT_COLOR = 0xffe14a;
const SELECT_RADIUS = TILE_SIZE * 0.52;
const SELECT_Y_OFFSET = 0.08 * UNITS_PER_METER;
const CAPACITY = 64;

/** @param {THREE.Scene} scene */
export function createFurnaceSelectionViz(scene) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(CAPACITY * 8 * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({
    color: SELECT_COLOR,
    depthTest: false,
    transparent: true,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 999;
  scene.add(lines);

  // Cheap signature of last-drawn selection so we can skip the GPU upload
  // when nothing changed. Selection edits come from click handlers (rare),
  // but update() runs every frame. Tile anchors don't move once placed, so
  // id-set equality is sufficient — no need to hash tile coords.
  let lastSig = '';

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {Set<number>} selected
   */
  function update(world, grid, selected) {
    let sig = '';
    for (const id of selected) sig += `${id},`;
    if (sig === lastSig) return;
    lastSig = sig;

    let n = 0;
    for (const id of selected) {
      if (n >= CAPACITY) break;
      const a = world.get(id, 'TileAnchor');
      if (!a) continue;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j) + SELECT_Y_OFFSET;
      writeSquareOutline(positions, n * 8 * 3, w.x, y, w.z, SELECT_RADIUS);
      n++;
    }
    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, n * 8);
    lines.visible = n > 0;
  }

  return { update };
}
