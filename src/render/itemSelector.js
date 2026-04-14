/**
 * Click-to-select an item stack.
 *
 * Items are anchored to tile centers, so picking is tile-based: raycast the
 * tile mesh, derive (i, j), find the item entity on that tile. Avoids the
 * per-instance id wiring cowSelector needs — items pack multiple kinds into
 * one mesh, and two stacks on one tile would be ambiguous either way.
 *
 * Selection semantics mirror CowSelector:
 *   - Plain LMB on stack    → replace with that stack.
 *   - Shift+LMB on stack    → toggle stack in current selection.
 *   - Plain LMB on empty    → clear selection.
 *   - Double-click on stack → replace with every same-kind stack currently
 *                             inside the camera frustum.
 *
 * Capture-phase listener runs after CowSelector so cows win ties. On a hit
 * it stopImmediatePropagation's to keep the tile picker + designators quiet.
 */

import * as THREE from 'three';
import { worldToTile } from '../world/coords.js';

const _ndc = new THREE.Vector2();
const _frustum = new THREE.Frustum();
const _projView = new THREE.Matrix4();
const _point = new THREE.Vector3();

export class ItemSelector {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {() => THREE.Mesh} getTileMesh
   * @param {{ W: number, H: number }} grid
   * @param {import('../ecs/world.js').World} world
   * @param {(id: number | null, additive: boolean) => void} onSelect
   * @param {(ids: number[]) => void} onSelectMany
   */
  constructor(dom, camera, getTileMesh, grid, world, onSelect, onSelectMany) {
    this.dom = dom;
    this.camera = camera;
    this.getTileMesh = getTileMesh;
    this.grid = grid;
    this.world = world;
    this.onSelect = onSelect;
    this.onSelectMany = onSelectMany;
    this.raycaster = new THREE.Raycaster();
    dom.addEventListener('click', (e) => this.#handleClick(e), { capture: true });
    dom.addEventListener('dblclick', (e) => this.#handleDouble(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #handleClick(e) {
    if (e.button !== 0) return;
    const tile = this.#pickTile(e);
    if (!tile) {
      if (!e.shiftKey) this.onSelect(null, false);
      return;
    }
    const id = this.#itemAt(tile.i, tile.j);
    if (id === null) {
      if (!e.shiftKey) this.onSelect(null, false);
      return;
    }
    this.onSelect(id, e.shiftKey);
    e.stopImmediatePropagation();
  }

  /** @param {MouseEvent} e */
  #handleDouble(e) {
    if (e.button !== 0) return;
    const tile = this.#pickTile(e);
    if (!tile) return;
    const id = this.#itemAt(tile.i, tile.j);
    if (id === null) return;
    const kind = this.#kindOf(id);
    if (!kind) return;
    const ids = this.#visibleOfKind(kind);
    if (ids.length === 0) return;
    this.onSelectMany(ids);
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
  #itemAt(i, j) {
    for (const { id, components } of this.world.query(['Item', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i === i && a.j === j) return id;
    }
    return null;
  }

  /** @param {number} id */
  #kindOf(id) {
    return this.world.get(id, 'Item')?.kind ?? null;
  }

  /** @param {string} kind */
  #visibleOfKind(kind) {
    this.camera.updateMatrixWorld();
    _projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projView);
    const out = [];
    for (const { id, components } of this.world.query(['Item', 'Position'])) {
      if (components.Item.kind !== kind) continue;
      const pos = components.Position;
      _point.set(pos.x, pos.y, pos.z);
      if (_frustum.containsPoint(_point)) out.push(id);
    }
    return out;
  }
}
