/**
 * Click-to-select a furnace. Tile-based pick (raycast → (i,j) → find Furnace
 * anchored there). Runs capture-phase AFTER ItemSelector so items on the work
 * spot still win, but before TilePicker/designators so a plain click on a
 * furnace doesn't fall through to the build tab.
 *
 * Plain LMB replaces the selection; Shift+LMB toggles. No multi-pick yet —
 * the bills panel only edits one furnace at a time.
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
    const tile = this.#pickTile(e);
    if (!tile) {
      if (!e.shiftKey) this.onSelect(null, false);
      return;
    }
    const id = this.#furnaceAt(tile.i, tile.j);
    if (id === null) {
      if (!e.shiftKey) this.onSelect(null, false);
      return;
    }
    this.onSelect(id, e.shiftKey);
    e.stopImmediatePropagation();
  }

  /** @param {MouseEvent} e */
  #pickTile(e) {
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.getTileMesh(), false);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    const t = worldToTile(p.x, p.z, this.grid.W, this.grid.H);
    if (t.i < 0) return null;
    return t;
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
