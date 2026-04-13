/**
 * Wireframe square on whatever tile the player last clicked. Helpful for
 * lining up drop-item debug keys (G/J) and generally knowing where "the
 * picked tile" is when the HUD says `pick: i=... j=...`.
 *
 * Single 5-vertex closed Line. Hidden when pick is null.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const GROUND_CLEARANCE = 0.05 * UNITS_PER_METER;

/**
 * @param {THREE.Scene} scene
 */
export function createPickTileOverlay(scene) {
  const positions = new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 0, -0.5,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xffcf40,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const line = new THREE.Line(geometry, material);
  line.scale.set(TILE_SIZE, 1, TILE_SIZE);
  line.renderOrder = 5;
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);

  let visible = true;

  /**
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {{ i: number, j: number } | null} pick
   */
  function update(grid, pick) {
    if (!visible || !pick || !grid.inBounds(pick.i, pick.j)) {
      line.visible = false;
      return;
    }
    const w = tileToWorld(pick.i, pick.j, grid.W, grid.H);
    const y = grid.getElevation(pick.i, pick.j) + GROUND_CLEARANCE;
    line.position.set(w.x, y, w.z);
    line.visible = true;
  }

  /** @param {boolean} v */
  function setVisible(v) {
    visible = v;
    if (!v) line.visible = false;
  }

  return { update, setVisible };
}
