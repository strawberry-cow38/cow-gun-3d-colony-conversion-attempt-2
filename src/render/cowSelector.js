/**
 * Click-to-select a cow.
 *
 * Raycasts against the cow InstancedMesh on click. If a hit, looks up the
 * entity id via the instancer's slot map and fires onSelect(entityId). Misses
 * call onSelect(null) so the UI can clear its panel.
 *
 * Listens with `capture: true` so it runs before the TilePicker — a click on a
 * cow shouldn't also count as a click on the tile under the cow.
 */

import * as THREE from 'three';

const _ndc = new THREE.Vector2();

export class CowSelector {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {{ mesh: THREE.InstancedMesh, entityFromInstanceId: (i: number) => number | null }} instancer
   * @param {(entityId: number | null) => void} onSelect
   */
  constructor(dom, camera, instancer, onSelect) {
    this.dom = dom;
    this.camera = camera;
    this.instancer = instancer;
    this.onSelect = onSelect;
    this.raycaster = new THREE.Raycaster();
    dom.addEventListener('click', (e) => this.#handle(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #handle(e) {
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.instancer.mesh, false);
    if (hits.length === 0) {
      this.onSelect(null);
      return;
    }
    const instanceId = hits[0].instanceId;
    if (instanceId === undefined) {
      this.onSelect(null);
      return;
    }
    const ent = this.instancer.entityFromInstanceId(instanceId);
    this.onSelect(ent);
    e.stopPropagation();
  }
}
