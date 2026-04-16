/**
 * Yellow outline around every selected crafting station. Single LineSegments
 * with a pooled vertex buffer. Furnace + easel draw a single-tile square at
 * the anchor; stove draws a 3x1 rectangle spanning the full footprint so the
 * whole body is highlighted, not just the middle tile.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { stoveFootprintTiles } from '../world/stove.js';
import { writeRectOutline, writeSquareOutline } from './selectionGeom.js';

const SELECT_COLOR = 0xffe14a;
const SELECT_RADIUS = TILE_SIZE * 0.52;
const STOVE_HALF_SHORT = TILE_SIZE * 0.52;
const STOVE_HALF_LONG = TILE_SIZE * 1.52;
const SELECT_Y_OFFSET = 0.08 * UNITS_PER_METER;
const CAPACITY = 64;

/** @param {THREE.Scene} scene */
export function createStationSelectionViz(scene) {
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

  // Signature of last-drawn selection so we can skip the GPU upload when
  // nothing changed. Stove selections rebuild whenever facing changes too,
  // because the outline orientation depends on it.
  let lastSig = '';

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {{
   *   selectedFurnaces: Set<number>,
   *   selectedEasels: Set<number>,
   *   selectedStoves: Set<number>,
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
    if (sig === lastSig) return;
    lastSig = sig;

    let n = 0;
    n = drawSquares(positions, n, world, grid, sel.selectedFurnaces);
    n = drawSquares(positions, n, world, grid, sel.selectedEasels);
    n = drawStoves(positions, n, world, grid, sel.selectedStoves);

    geo.attributes.position.needsUpdate = true;
    geo.setDrawRange(0, n * 8);
    lines.visible = n > 0;
  }

  return { update };
}

/**
 * @param {Float32Array} positions
 * @param {number} startN
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {Set<number>} selected
 */
function drawSquares(positions, startN, world, grid, selected) {
  let n = startN;
  for (const id of selected) {
    if (n >= CAPACITY) break;
    const a = world.get(id, 'TileAnchor');
    if (!a) continue;
    const w = tileToWorld(a.i, a.j, grid.W, grid.H);
    const y = grid.getElevation(a.i, a.j) + SELECT_Y_OFFSET;
    writeSquareOutline(positions, n * 8 * 3, w.x, y, w.z, SELECT_RADIUS);
    n++;
  }
  return n;
}

/**
 * Stove body spans three tiles. Compute the bounding rectangle across the
 * footprint and draw a single outline — one long box feels more like
 * "selected that appliance" than three stacked squares would.
 *
 * @param {Float32Array} positions
 * @param {number} startN
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {Set<number>} selected
 */
function drawStoves(positions, startN, world, grid, selected) {
  let n = startN;
  for (const id of selected) {
    if (n >= CAPACITY) break;
    const a = world.get(id, 'TileAnchor');
    const s = world.get(id, 'Stove');
    if (!a || !s) continue;
    const tiles = stoveFootprintTiles(a, s.facing | 0);
    const ends = [tiles[0], tiles[2]];
    const w0 = tileToWorld(ends[0].i, ends[0].j, grid.W, grid.H);
    const w1 = tileToWorld(ends[1].i, ends[1].j, grid.W, grid.H);
    const cx = (w0.x + w1.x) * 0.5;
    const cz = (w0.z + w1.z) * 0.5;
    const horizontal = Math.abs(w1.x - w0.x) > Math.abs(w1.z - w0.z);
    const rx = horizontal ? STOVE_HALF_LONG : STOVE_HALF_SHORT;
    const rz = horizontal ? STOVE_HALF_SHORT : STOVE_HALF_LONG;
    const y = grid.getElevation(a.i, a.j) + SELECT_Y_OFFSET;
    writeRectOutline(positions, n * 8 * 3, cx, y, cz, rx, rz);
    n++;
  }
  return n;
}
