/**
 * Click-to-uninstall a painting on the wall.
 *
 * Raycasts the wallArtInstancer's frame + canvas InstancedMeshes. A left-click
 * on either directly queues an uninstall job for that WallArt — no build-tab
 * tool toggle needed. The toggleable `UninstallDesignator` stays around for
 * players who want to queue many uninstalls from a distance by clicking floor
 * tiles; this is the direct "click the painting" path master kept asking for.
 *
 * Uses `capture: true` so it wins against the tile picker. On a hit we
 * stopImmediatePropagation to prevent the designator layer from also firing.
 *
 * Cancelling: clicking a painting with an open uninstall job completes that
 * job (releases the cow if she's not mid-work) and clears the queue flag.
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
      // Already queued. Cancel only if no cow has claimed it yet — once a
      // cow is walking/prying, yanking the job out from under her would leave
      // her stuck in a job state machine whose target no longer exists on
      // the board. Claimed jobs stay queued; the player can re-click after
      // the cow finishes, or not.
      const job = this.board.jobs.find((j) => j.id === art.uninstallJobId && !j.completed);
      if (job && job.claimedBy === null) {
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
      // No reachable viewer tile — nothing to queue. Play the negative cue so
      // the player knows the click registered but can't proceed.
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

  /**
   * Mirrors UninstallDesignator.#findWorkSpot — first walkable adjacent tile
   * on the face side across the span.
   *
   * @param {{ i: number, j: number }} anchor
   * @param {number} face
   * @param {number} size
   */
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
