/**
 * Click-to-select a furnace. Tile-based picking — raycast the tile mesh to
 * resolve (i, j), then check whether a furnace sits on that tile. This mirrors
 * ItemSelector's approach and, crucially, survives item stacks rendering in
 * front of (or on top of) the furnace body: whichever way the pixel reads,
 * the underlying tile is still the furnace's, so the furnace wins.
 *
 * Registered in capture-phase BEFORE ItemSelector. On a furnace tile we
 * stopImmediatePropagation so items sharing that tile don't steal focus;
 * on any other tile we fall through and the item picker handles it.
 *
 * Plain LMB replaces the selection; Shift+LMB toggles.
 */

import * as THREE from 'three';
import { worldToTile } from '../world/coords.js';

const _ndc = new THREE.Vector2();

export class FurnaceSelector {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {() => THREE.Mesh} getTileMesh
   * @param {{ W: number, H: number }} grid
   * @param {import('../ecs/world.js').World} world
   * @param {(id: number | null, additive: boolean) => void} onSelect
   */
  constructor(dom, camera, getTileMesh, grid, world, onSelect) {
    this.dom = dom;
    this.camera = camera;
    this.getTileMesh = getTileMesh;
    this.grid = grid;
    this.world = world;
    this.onSelect = onSelect;
    this.raycaster = new THREE.Raycaster();
    dom.addEventListener('click', (e) => this.#handleClick(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #handleClick(e) {
    if (e.button !== 0) return;
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.getTileMesh(), false);
    if (hits.length === 0) return;
    const p = hits[0].point;
    const t = worldToTile(p.x, p.z, this.grid.W, this.grid.H);
    if (t.i < 0) return;
    const id = this.#furnaceAt(t.i, t.j);
    if (id === null) return;
    this.onSelect(id, e.shiftKey);
    e.stopImmediatePropagation();
  }

  /** @param {number} i @param {number} j */
  #furnaceAt(i, j) {
    for (const { id, components } of this.world.query(['Furnace', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i === i && a.j === j) return id;
    }
    return null;
  }
}
