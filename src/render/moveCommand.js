/**
 * Right-click-to-move: when a cow is selected and the user right-clicks a
 * tile, A* a route and assign it as a player-issued 'move' job. Brain
 * cleans the job back to 'none' once the path is consumed, so wander
 * resumes naturally.
 *
 * Listens for `contextmenu` on the canvas; RtsCamera already preventDefaults
 * the browser menu.
 */

import * as THREE from 'three';
import { TILE_SIZE, worldToTile } from '../world/coords.js';

const _ndc = new THREE.Vector2();

export class CowMoveCommand {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {() => THREE.Mesh} getTileMesh  (tile mesh is rebuilt on load, so resolve lazily)
   * @param {import('../world/tileGrid.js').TileGrid} tileGrid
   * @param {import('../sim/pathfinding.js').PathCache} pathCache
   * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
   * @param {import('../ecs/world.js').World} world
   * @param {() => (number | null)} getSelectedCow
   */
  constructor(dom, camera, getTileMesh, tileGrid, pathCache, walkable, world, getSelectedCow) {
    this.dom = dom;
    this.camera = camera;
    this.getTileMesh = getTileMesh;
    this.tileGrid = tileGrid;
    this.pathCache = pathCache;
    this.walkable = walkable;
    this.world = world;
    this.getSelectedCow = getSelectedCow;
    this.raycaster = new THREE.Raycaster();
    dom.addEventListener('contextmenu', (e) => this.#handle(e));
  }

  /** @param {MouseEvent} e */
  #handle(e) {
    const id = this.getSelectedCow();
    if (id === null) return;
    const pos = this.world.get(id, 'Position');
    const path = this.world.get(id, 'Path');
    const job = this.world.get(id, 'Job');
    if (!pos || !path || !job) return;

    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.getTileMesh(), false);
    if (hits.length === 0) return;

    const p = hits[0].point;
    const goal = worldToTile(p.x, p.z, this.tileGrid.W, this.tileGrid.H);
    if (goal.i < 0) return;
    if (!this.walkable(this.tileGrid, goal.i, goal.j)) {
      console.log('[move] tile not walkable:', goal);
      return;
    }

    const start = clampToGrid(pos.x, pos.z, this.tileGrid);
    const route = this.pathCache.find(start, goal);
    if (!route || route.length === 0) {
      console.log('[move] no path to', goal);
      return;
    }
    path.steps = route;
    path.index = 0;
    job.kind = 'move';
    job.state = 'moving';
    job.payload = { goal };
  }
}

/**
 * @param {number} x @param {number} z
 * @param {import('../world/tileGrid.js').TileGrid} grid
 */
function clampToGrid(x, z, grid) {
  const i = Math.floor(x / TILE_SIZE + grid.W / 2);
  const j = Math.floor(z / TILE_SIZE + grid.H / 2);
  return { i: Math.max(0, Math.min(grid.W - 1, i)), j: Math.max(0, Math.min(grid.H - 1, j)) };
}
