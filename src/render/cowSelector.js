/**
 * Click-to-select a cow.
 *
 * Direct raycast against the cow-hitbox InstancedMesh (see cowHitboxes.js,
 * one oriented bounding box per cow, tracks the rendered figure). No
 * proximity fallback — the hitbox is already sized generously for cursor
 * slop, so clicks outside the silhouette should clear selection instead of
 * snapping to whichever colonist happens to be closest.
 *
 * Listens with `capture: true` so it runs before the TilePicker; on a hit
 * it calls `stopImmediatePropagation` to prevent the tile click from also
 * firing.
 *
 * Selection semantics:
 *   - Plain LMB on cow      → replace selection with that cow.
 *   - Shift+LMB on cow      → toggle that cow in the current selection.
 *   - Plain LMB on empty    → clear selection.
 *   - Shift+LMB on empty    → no change.
 */

import * as THREE from 'three';

const _ndc = new THREE.Vector2();

export class CowSelector {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {{ mesh: THREE.InstancedMesh, entityFromInstanceId: (i: number) => number | null }} hitboxes
   * @param {() => THREE.Group} _getTileMesh  kept for signature stability;
   *                                         no longer used.
   * @param {import('../ecs/world.js').World} _world  kept for signature
   *                                                  stability; no longer used.
   * @param {(entityId: number | null, additive: boolean) => void} onSelect
   * @param {{ isDesignatorActive?: () => boolean }} [opts]
   */
  constructor(dom, camera, hitboxes, _getTileMesh, _world, onSelect, opts = {}) {
    this.dom = dom;
    this.camera = camera;
    this.hitboxes = hitboxes;
    this.onSelect = onSelect;
    this.isDesignatorActive = opts.isDesignatorActive ?? (() => false);
    this.raycaster = new THREE.Raycaster();
    dom.addEventListener('click', (e) => this.#handle(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #handle(e) {
    if (this.isDesignatorActive()) return;
    const additive = e.shiftKey;
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);

    const direct = this.raycaster.intersectObject(this.hitboxes.mesh, false);
    if (direct.length > 0 && direct[0].instanceId !== undefined) {
      const ent = this.hitboxes.entityFromInstanceId(direct[0].instanceId);
      if (ent !== null) {
        this.onSelect(ent, additive);
        e.stopImmediatePropagation();
        return;
      }
    }

    this.onSelect(null, additive);
  }
}
