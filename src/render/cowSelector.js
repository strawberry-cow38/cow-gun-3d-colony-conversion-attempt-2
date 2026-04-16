/**
 * Click-to-select a cow.
 *
 * Two-stage pick:
 * 1. Direct raycast against an invisible cow-hitbox InstancedMesh — sized
 *    to encapsulate the whole figure (head + hair + arms + legs) so the
 *    click target is generous even at default RTS zoom.
 * 2. Fallback: raycast against the tile mesh and pick the nearest cow within
 *    `pickRadius` world units of that hit point. Catches clicks that land
 *    just past the edge of a cow's silhouette.
 *
 * Listens with `capture: true` so it runs before the TilePicker; on a hit it
 * calls `stopImmediatePropagation` to prevent the tile click from also firing.
 *
 * Selection semantics:
 *   - Plain LMB on cow      → replace selection with that cow.
 *   - Shift+LMB on cow      → toggle that cow in the current selection.
 *   - Plain LMB on empty    → clear selection.
 *   - Shift+LMB on empty    → no change.
 * The callback receives `(entityId | null, additive)` and the consumer
 * decides how to merge.
 */

import * as THREE from 'three';
import { TILE_SIZE } from '../world/coords.js';

const _ndc = new THREE.Vector2();

export class CowSelector {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {{ mesh: THREE.InstancedMesh, entityFromInstanceId: (i: number) => number | null }} hitboxes
   *   full-figure click target (see cowHitboxes.js).
   * @param {() => THREE.Mesh} getTileMesh  resolved per-click so Save/Load
   *                                         mesh swaps don't strand a stale ref.
   * @param {import('../ecs/world.js').World} world
   * @param {(entityId: number | null, additive: boolean) => void} onSelect
   * @param {{ pickRadius?: number, isDesignatorActive?: () => boolean }} [opts]
   */
  constructor(dom, camera, hitboxes, getTileMesh, world, onSelect, opts = {}) {
    this.dom = dom;
    this.camera = camera;
    this.hitboxes = hitboxes;
    this.getTileMesh = getTileMesh;
    this.world = world;
    this.onSelect = onSelect;
    this.pickRadius = opts.pickRadius ?? TILE_SIZE * 1.5;
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

    // 1) direct raycast against full-figure hitboxes
    const direct = this.raycaster.intersectObject(this.hitboxes.mesh, false);
    if (direct.length > 0 && direct[0].instanceId !== undefined) {
      const ent = this.hitboxes.entityFromInstanceId(direct[0].instanceId);
      if (ent !== null) {
        this.onSelect(ent, additive);
        e.stopImmediatePropagation();
        return;
      }
    }

    // 2) fallback: pick nearest cow near the tile we clicked
    const tileHit = this.raycaster.intersectObject(this.getTileMesh(), false);
    if (tileHit.length === 0) {
      this.onSelect(null, additive);
      return;
    }
    const p = tileHit[0].point;
    let best = /** @type {number | null} */ (null);
    let bestDistSq = this.pickRadius * this.pickRadius;
    for (const { id, components } of this.world.query(['Cow', 'Position'])) {
      const pos = components.Position;
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        best = id;
      }
    }
    if (best !== null) {
      this.onSelect(best, additive);
      e.stopImmediatePropagation();
      return;
    }
    this.onSelect(null, additive);
  }
}
