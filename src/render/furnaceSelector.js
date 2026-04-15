/**
 * Click-to-select a furnace. Raycasts against the furnace body/chimney
 * InstancedMesh so clicks land on the 3D model directly — even when an
 * item stack sits on the same tile (previously tile-based picking let
 * the item selector win every time).
 *
 * Registered capture-phase BEFORE ItemSelector: on a mesh hit the
 * selector stops propagation so items on the same tile don't steal
 * focus; on a miss it falls through so items elsewhere still pick.
 *
 * Plain LMB replaces the selection; Shift+LMB toggles. No multi-pick yet —
 * the bills panel only edits one furnace at a time.
 */

import * as THREE from 'three';

const _ndc = new THREE.Vector2();

export class FurnaceSelector {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {() => THREE.Object3D[]} getHitMeshes  furnace body + chimney instanced meshes
   * @param {(instanceId: number) => number | null} entityFromInstanceId
   * @param {(id: number | null, additive: boolean) => void} onSelect
   */
  constructor(dom, camera, getHitMeshes, entityFromInstanceId, onSelect) {
    this.dom = dom;
    this.camera = camera;
    this.getHitMeshes = getHitMeshes;
    this.entityFromInstanceId = entityFromInstanceId;
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
    const hits = this.raycaster.intersectObjects(this.getHitMeshes(), false);
    if (hits.length === 0) return;
    const hit = hits[0];
    const instanceId = hit.instanceId;
    if (typeof instanceId !== 'number') return;
    const id = this.entityFromInstanceId(instanceId);
    if (id === null) return;
    this.onSelect(id, e.shiftKey);
    e.stopImmediatePropagation();
  }
}
