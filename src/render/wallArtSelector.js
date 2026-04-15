/**
 * Click-to-uninstall a painting on the wall. Raycasts the wallArtInstancer's
 * meshes and queues an uninstall job on hit; re-click cancels if unclaimed.
 * Capture-phase so we can stopImmediatePropagation and beat the tile picker.
 */

import * as THREE from 'three';
import { defaultWalkable } from '../sim/pathfinding.js';
import { FACING_OFFSETS, FACING_SPAN_OFFSETS } from '../world/facing.js';

const _ndc = new THREE.Vector2();

export class WallArtSelector {
  /**
   * @param {{
   *   canvas: HTMLElement,
   *   camera: THREE.PerspectiveCamera,
   *   instancer: {
   *     frameMesh: THREE.InstancedMesh,
   *     canvasMesh: THREE.InstancedMesh,
   *     entityFromInstanceId: (i: number) => number | null,
   *   },
   *   tileGrid: import('../world/tileGrid.js').TileGrid,
   *   world: import('../ecs/world.js').World,
   *   jobBoard: import('../jobs/board.js').JobBoard,
   *   audio?: { play: (kind: string) => void },
   * }} opts
   */
  constructor({ canvas, camera, instancer, tileGrid, world, jobBoard, audio }) {
    this.dom = canvas;
    this.camera = camera;
    this.instancer = instancer;
    this.tileGrid = tileGrid;
    this.world = world;
    this.board = jobBoard;
    this.audio = audio;
    this.raycaster = new THREE.Raycaster();
    canvas.addEventListener('click', (e) => this.#onClick(e), { capture: true });
  }

  /** @param {MouseEvent} e */
  #onClick(e) {
    if (e.button !== 0) return;
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);
    const meshes = [this.instancer.canvasMesh, this.instancer.frameMesh];
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0 || hits[0].instanceId === undefined) return;
    const wallArtId = this.instancer.entityFromInstanceId(hits[0].instanceId);
    if (wallArtId === null) return;
    const art = this.world.get(wallArtId, 'WallArt');
    const anchor = this.world.get(wallArtId, 'TileAnchor');
    if (!art || !anchor) return;

    if (art.uninstallJobId > 0) {
      // Only cancel if unclaimed — yanking a job from a cow mid-pry would
      // strand her in a state machine whose target is gone.
      const job = this.board.get(art.uninstallJobId);
      if (job && !job.completed && job.claimedBy === null) {
        this.board.complete(job.id);
        art.uninstallJobId = 0;
        this.audio?.play('toggle_off');
      } else {
        this.audio?.play('click');
      }
      e.stopImmediatePropagation();
      return;
    }

    const workSpot = this.#findWorkSpot(anchor, art.face | 0, Math.max(1, art.size | 0));
    if (!workSpot) {
      this.audio?.play('deny');
      e.stopImmediatePropagation();
      return;
    }
    const job = this.board.post('uninstall', {
      wallArtId,
      workI: workSpot.i,
      workJ: workSpot.j,
    });
    art.uninstallJobId = job.id;
    this.audio?.play('command');
    e.stopImmediatePropagation();
  }

  #findWorkSpot(anchor, face, size) {
    const grid = this.tileGrid;
    const step = FACING_SPAN_OFFSETS[face] ?? FACING_SPAN_OFFSETS[0];
    const offset = FACING_OFFSETS[face] ?? FACING_OFFSETS[0];
    for (let k = 0; k < size; k++) {
      const wi = anchor.i + step.di * k;
      const wj = anchor.j + step.dj * k;
      const vi = wi + offset.di;
      const vj = wj + offset.dj;
      if (!grid.inBounds(vi, vj)) continue;
      if (!defaultWalkable(grid, vi, vj)) continue;
      return { i: vi, j: vj };
    }
    return null;
  }
}
