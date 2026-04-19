/**
 * Click-to-select an item stack.
 *
 * Raycasts against the invisible `itemHitboxes` InstancedMesh — each box is
 * sized to the actual rendered footprint, so clicks just outside a log pile
 * fall through to the tile picker (letting stockpiles under the stack be
 * selected). Falls back to tile picking only when the ray misses every
 * hitbox.
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

import { frustumVisibleIds, pickEntityFromEvent } from './tilePickUtils.js';

export class ItemSelector {
  /**
   * @param {HTMLElement} dom
   * @param {import('three').PerspectiveCamera} camera
   * @param {{ mesh: import('three').InstancedMesh, entityFromInstanceId: (i: number) => number | null }} hitboxes
   * @param {import('../ecs/world.js').World} world
   * @param {(id: number | null, additive: boolean) => void} onSelect
   * @param {(ids: number[]) => void} onSelectMany
   * @param {{ isDesignatorActive?: () => boolean }} [opts]
   */
  constructor(dom, camera, hitboxes, world, onSelect, onSelectMany, opts = {}) {
    this.dom = dom;
    this.camera = camera;
    this.hitboxes = hitboxes;
    this.world = world;
    this.onSelect = onSelect;
    this.onSelectMany = onSelectMany;
    this.isDesignatorActive = opts.isDesignatorActive ?? (() => false);
    dom.addEventListener('click', (e) => this.#handleClick(e), { capture: true });
    dom.addEventListener('dblclick', (e) => this.#handleDouble(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #handleClick(e) {
    if (e.button !== 0) return;
    if (this.isDesignatorActive()) return;
    const id = pickEntityFromEvent(e, this.dom, this.camera, this.hitboxes);
    if (id === null) return;
    this.onSelect(id, e.shiftKey);
    e.stopImmediatePropagation();
  }

  /** @param {MouseEvent} e */
  #handleDouble(e) {
    if (e.button !== 0) return;
    if (this.isDesignatorActive()) return;
    const id = pickEntityFromEvent(e, this.dom, this.camera, this.hitboxes);
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
}
