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

import { frustumVisibleIds, pickTileFromEvent } from './tilePickUtils.js';

export class ItemSelector {
  /**
   * @param {HTMLElement} dom
   * @param {import('three').PerspectiveCamera} camera
   * @param {() => import('three').Mesh} getTileMesh
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
    dom.addEventListener('click', (e) => this.#handleClick(e), { capture: true });
    dom.addEventListener('dblclick', (e) => this.#handleDouble(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #handleClick(e) {
    if (e.button !== 0) return;
    const tile = pickTileFromEvent(e, this.dom, this.camera, this.getTileMesh(), this.grid);
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
    const tile = pickTileFromEvent(e, this.dom, this.camera, this.getTileMesh(), this.grid);
    if (!tile) return;
    const id = this.#itemAt(tile.i, tile.j);
    if (id === null) return;
    const kind = this.world.get(id, 'Item')?.kind;
    if (!kind) return;
    const ids = frustumVisibleIds(
      this.camera,
      this.world,
      ['Item', 'Position'],
      (c) => c.Item.kind === kind,
    );
    if (ids.length === 0) return;
    this.onSelectMany(ids);
    e.stopImmediatePropagation();
  }

  /** @param {number} i @param {number} j */
  #itemAt(i, j) {
    for (const { id, components } of this.world.query(['Item', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i === i && a.j === j) return id;
    }
    return null;
  }
}
