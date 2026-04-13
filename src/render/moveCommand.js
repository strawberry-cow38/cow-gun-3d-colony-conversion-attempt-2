/**
 * Right-click-to-move: when a cow is selected and the user right-clicks a
 * tile, A* a route and assign it as a player-issued 'move' job. Brain
 * cleans the job back to 'none' once the path is consumed, so wander
 * resumes naturally.
 *
 * Shift-modifier queues waypoints without interrupting the cow's current
 * progress: A* from the last queued waypoint to the new tile and append
 * those steps to `Path.steps`. `Job.payload.legEnds` records the step-
 * index boundaries so the brain can pop completed waypoints as the cow
 * advances. Plain RMB replaces the whole plan and re-plans from the
 * cow's current tile.
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
   * @param {() => Iterable<number>} getSelectedCows
   */
  constructor(dom, camera, getTileMesh, tileGrid, pathCache, walkable, world, getSelectedCows) {
    this.dom = dom;
    this.camera = camera;
    this.getTileMesh = getTileMesh;
    this.tileGrid = tileGrid;
    this.pathCache = pathCache;
    this.walkable = walkable;
    this.world = world;
    this.getSelectedCows = getSelectedCows;
    this.raycaster = new THREE.Raycaster();
    dom.addEventListener('contextmenu', (e) => this.#handle(e));
  }

  /** @param {MouseEvent} e */
  #handle(e) {
    const ids = [...this.getSelectedCows()];
    if (ids.length === 0) return;

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

    // Spread cows across distinct walkable tiles radiating out from `goal` so
    // they don't all stack onto the same square.
    const targets = spreadTargets(this.tileGrid, this.walkable, goal, ids.length);
    for (let k = 0; k < ids.length; k++) {
      this.#issue(ids[k], targets[k], e.shiftKey);
    }
  }

  /**
   * @param {number} id
   * @param {{ i: number, j: number }} goal
   * @param {boolean} shiftKey
   */
  #issue(id, goal, shiftKey) {
    const pos = this.world.get(id, 'Position');
    const path = this.world.get(id, 'Path');
    const job = this.world.get(id, 'Job');
    if (!pos || !path || !job) return;

    const existingWaypoints = /** @type {{i:number,j:number}[]} */ (job.payload.waypoints ?? []);
    const existingLegEnds = /** @type {number[]} */ (job.payload.legEnds ?? []);
    const canQueue =
      shiftKey &&
      job.kind === 'move' &&
      existingWaypoints.length > 0 &&
      path.index < path.steps.length;

    if (canQueue) {
      const lastWp = existingWaypoints[existingWaypoints.length - 1];
      const leg = this.pathCache.find(lastWp, goal);
      if (!leg || leg.length === 0) {
        console.log('[move] no path to new waypoint:', goal, 'for cow', id);
        return;
      }
      for (let k = 1; k < leg.length; k++) path.steps.push(leg[k]);
      existingLegEnds.push(path.steps.length - 1);
      existingWaypoints.push(goal);
      job.payload.waypoints = existingWaypoints;
      job.payload.legEnds = existingLegEnds;
      return;
    }

    const start = clampToGrid(pos.x, pos.z, this.tileGrid);
    const route = this.pathCache.find(start, goal);
    if (!route || route.length === 0) {
      console.log('[move] no path to', goal, 'for cow', id);
      return;
    }
    path.steps = route;
    path.index = 0;
    job.kind = 'move';
    job.state = 'moving';
    job.payload = { waypoints: [goal], legEnds: [route.length - 1] };
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

/**
 * BFS outward from `goal` to pick `count` distinct walkable tiles. Caller
 * guarantees `goal` is in-bounds and walkable, so the result is non-empty.
 * If we run out of reachable walkable tiles, remaining slots reuse `goal`.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {{ i: number, j: number }} goal
 * @param {number} count
 * @returns {{ i: number, j: number }[]}
 */
function spreadTargets(grid, walkable, goal, count) {
  /** @type {{ i: number, j: number }[]} */
  const out = [];
  const seen = new Uint8Array(grid.W * grid.H);
  /** @type {{ i: number, j: number }[]} */
  const queue = [{ i: goal.i, j: goal.j }];
  seen[goal.j * grid.W + goal.i] = 1;
  const nbrs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  let head = 0;
  while (out.length < count && head < queue.length) {
    const t = queue[head++];
    if (walkable(grid, t.i, t.j)) out.push(t);
    for (const [di, dj] of nbrs) {
      const ni = t.i + di;
      const nj = t.j + dj;
      if (ni < 0 || ni >= grid.W || nj < 0 || nj >= grid.H) continue;
      const idx = nj * grid.W + ni;
      if (seen[idx]) continue;
      seen[idx] = 1;
      queue.push({ i: ni, j: nj });
    }
  }
  while (out.length < count) out.push({ i: goal.i, j: goal.j });
  return out;
}
