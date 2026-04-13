/**
 * Mouse-to-tile raycaster.
 *
 * Raycast against the tile mesh at click. If hit, derive (i, j) from the
 * world-space hit point. Calls onPick({ i, j, x, z, point }) on each click.
 */

import * as THREE from 'three';
import { worldToTile } from '../world/coords.js';

const _ndc = new THREE.Vector2();

export class TilePicker {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {() => THREE.Mesh} getTileMesh  resolved per-click so Save/Load
   *                                         mesh swaps don't strand a stale ref.
   * @param {{ W: number, H: number }} grid
   * @param {(hit: { i: number, j: number, x: number, z: number, point: THREE.Vector3 } | null) => void} onPick
   */
  constructor(dom, camera, getTileMesh, grid, onPick) {
    this.dom = dom;
    this.camera = camera;
    this.getTileMesh = getTileMesh;
    this.grid = grid;
    this.onPick = onPick;
    this.raycaster = new THREE.Raycaster();
    dom.addEventListener('click', (e) => this.#handle(e));
  }

  /** @param {MouseEvent} e */
  #handle(e) {
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.getTileMesh(), false);
    if (hits.length === 0) {
      this.onPick(null);
      return;
    }
    const point = hits[0].point;
    const { i, j } = worldToTile(point.x, point.z, this.grid.W, this.grid.H);
    this.onPick({ i, j, x: point.x, z: point.z, point });
  }
}
