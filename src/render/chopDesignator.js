/**
 * Chop designation mode.
 *
 * Press `C` to enter "mark trees" mode; click trees to toggle their ChopTarget
 * marker + a corresponding job on the JobBoard. Press `C` or `Escape` to exit.
 *
 * LMB uses a capture-phase handler so it swallows the click before CowSelector
 * can interpret it as a deselect.
 */

import * as THREE from 'three';

const _ndc = new THREE.Vector2();

export class ChopDesignator {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {{ trunkMesh: THREE.InstancedMesh, canopyMesh: THREE.InstancedMesh, entityFromInstanceId: (id: number) => number | null, markDirty: () => void }} treeInstancer
   * @param {import('../ecs/world.js').World} world
   * @param {import('../jobs/board.js').JobBoard} board
   * @param {() => void} onStateChanged  called whenever mode toggles or a tree is marked
   * @param {{ play: (kind: string) => void }} [audio]
   */
  constructor(dom, camera, treeInstancer, world, board, onStateChanged, audio) {
    this.dom = dom;
    this.camera = camera;
    this.trees = treeInstancer;
    this.world = world;
    this.board = board;
    this.onStateChanged = onStateChanged;
    this.audio = audio;
    this.active = false;
    this.raycaster = new THREE.Raycaster();

    dom.addEventListener('click', (e) => this.#onClick(e), true);
    addEventListener('keydown', (e) => this.#onKey(e));
  }

  /** @param {KeyboardEvent} e */
  #onKey(e) {
    if (e.code === 'KeyC') {
      this.active = !this.active;
      this.audio?.play(this.active ? 'toggle_on' : 'toggle_off');
      this.onStateChanged();
    } else if (e.code === 'Escape' && this.active) {
      this.active = false;
      this.audio?.play('toggle_off');
      this.onStateChanged();
    }
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.audio?.play('toggle_off');
    this.onStateChanged();
  }

  /** @param {MouseEvent} e */
  #onClick(e) {
    if (!this.active || e.button !== 0) return;
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);
    const hits = this.raycaster.intersectObjects(
      [this.trees.trunkMesh, this.trees.canopyMesh],
      false,
    );
    if (hits.length === 0) return;
    const hit = hits[0];
    const instanceId = hit.instanceId;
    if (instanceId === undefined || instanceId === null) return;
    const treeId = this.trees.entityFromInstanceId(instanceId);
    if (treeId === null) return;
    this.#toggle(treeId);
    // Swallow so CowSelector doesn't treat this as a cow deselect.
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  /** @param {number} treeId */
  #toggle(treeId) {
    const tree = this.world.get(treeId, 'Tree');
    if (!tree) return;
    if (tree.markedJobId > 0) {
      this.board.complete(tree.markedJobId);
      tree.markedJobId = 0;
      tree.progress = 0;
    } else {
      const anchor = this.world.get(treeId, 'TileAnchor');
      if (!anchor) return;
      const job = this.board.post('chop', { treeId, i: anchor.i, j: anchor.j });
      tree.markedJobId = job.id;
      tree.progress = 0;
    }
    this.audio?.play('command');
    this.trees.markDirty();
    this.onStateChanged();
  }
}
