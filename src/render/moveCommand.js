/**
 * Right-click-to-move: when a cow is selected and the user right-clicks a
 * tile, A* a route and assign it as a player-issued 'move' job. Brain
 * cleans the job back to 'none' once the path is consumed, so wander
 * resumes naturally.
 *
 * Shift-modifier queues waypoints: each shift-RMB appends another tile
 * to `Job.payload.waypoints` and rebuilds the chained A* path from the
 * cow's current tile through every pending waypoint. `Job.payload.legEnds`
 * records the step-index boundaries so the brain can pop completed
 * waypoints as the cow advances.
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

    const queuing = e.shiftKey && job.kind === 'move';
    /** @type {{ i: number, j: number }[]} */
    const waypoints = queuing ? [...(job.payload.waypoints ?? []), goal] : [goal];

    const start = clampToGrid(pos.x, pos.z, this.tileGrid);
    const chained = chainLegs(this.pathCache, start, waypoints);
    if (!chained) {
      console.log('[move] no path through waypoints:', waypoints);
      return;
    }
    path.steps = chained.steps;
    path.index = 0;
    job.kind = 'move';
    job.state = 'moving';
    job.payload = { waypoints, legEnds: chained.legEnds };
  }
}

/**
 * Chain A* between `start → waypoints[0] → waypoints[1] → …`. Returns the
 * concatenated step list and the step-index boundary for each leg (inclusive
 * upper bound: `path.steps[legEnds[k]]` is the k-th waypoint tile). Returns
 * null if any leg is unreachable.
 *
 * Each leg's first step duplicates the previous leg's end tile, so we drop
 * it when concatenating — except on the very first leg.
 *
 * @param {import('../sim/pathfinding.js').PathCache} cache
 * @param {{ i: number, j: number }} start
 * @param {{ i: number, j: number }[]} waypoints
 */
function chainLegs(cache, start, waypoints) {
  /** @type {{ i: number, j: number }[]} */
  const steps = [];
  /** @type {number[]} */
  const legEnds = [];
  let cursor = start;
  for (const wp of waypoints) {
    const leg = cache.find(cursor, wp);
    if (!leg || leg.length === 0) return null;
    const slice = steps.length === 0 ? leg : leg.slice(1);
    for (const s of slice) steps.push(s);
    legEnds.push(steps.length - 1);
    cursor = wp;
  }
  return { steps, legEnds };
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
