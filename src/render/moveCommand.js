/**
 * Right-click-to-move:
 *
 * - RMB click  → everyone selected moves to that tile (spread onto distinct
 *   walkable tiles near it so nobody piles on the exact same square).
 * - RMB drag   → with multiple cows selected, drop a *line* of targets from
 *   the drag start to the drag end; each cow claims one evenly-spaced tile
 *   along the line (shifted to the nearest walkable tile if the raw spot
 *   isn't walkable). A warm preview line + per-cow diamond markers render
 *   live during the drag.
 * - Shift+RMB  → queue the new target(s) as waypoints instead of replacing
 *   the current plan. Preserves `path.index` so the cow doesn't snap back.
 *
 * The browser context menu is already suppressed by RtsCamera.
 */

import * as THREE from 'three';
import { jobVerbForPrioritize } from '../jobs/atTile.js';
import { findPrioritizableJobsAtTile, prioritizeJob } from '../jobs/prioritize.js';
import {
  TILE_SIZE,
  UNITS_PER_METER,
  tileToWorld,
  worldToTile,
  worldToTileClamp,
} from '../world/coords.js';

const _ndc = new THREE.Vector2();
/** Module-level BFS scratch reused by spreadTargets + nearestWalkable. */
let _bfsScratch = new Uint8Array(0);
const DRAG_THRESHOLD_PX = 6;
const PREVIEW_COLOR = 0xffe14a;
const PREVIEW_GROUND_CLEARANCE = 0.12 * UNITS_PER_METER;
const PREVIEW_MARKER_RADIUS = TILE_SIZE * 0.35;
const PREVIEW_MARKER_CAPACITY = 64;

export class CowMoveCommand {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {() => THREE.Mesh} getTileMesh  (tile mesh is rebuilt on load, so resolve lazily)
   * @param {import('../world/tileGrid.js').TileGrid} tileGrid
   * @param {import('../sim/pathfinding.js').PathCache} pathCache
   * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
   * @param {import('../ecs/world.js').World} world
   * @param {import('../jobs/board.js').JobBoard} jobBoard
   * @param {() => Iterable<number>} getSelectedCows
   * @param {THREE.Scene} scene
   * @param {{ show: (x: number, y: number, items: { label: string, onPick?: () => void, disabled?: boolean }[]) => void, hide: () => void }} contextMenu
   * @param {{ play: (kind: string) => void }} [audio]
   */
  constructor(
    dom,
    camera,
    getTileMesh,
    tileGrid,
    pathCache,
    walkable,
    world,
    jobBoard,
    getSelectedCows,
    scene,
    contextMenu,
    audio,
  ) {
    this.dom = dom;
    this.camera = camera;
    this.getTileMesh = getTileMesh;
    this.tileGrid = tileGrid;
    this.pathCache = pathCache;
    this.walkable = walkable;
    this.world = world;
    this.board = jobBoard;
    this.getSelectedCows = getSelectedCows;
    this.contextMenu = contextMenu;
    this.audio = audio;
    this.raycaster = new THREE.Raycaster();

    this.rmbDown = false;
    this.shiftAtDown = false;
    /** @type {{ i: number, j: number } | null} */
    this.startTile = null;
    this.startClientX = 0;
    this.startClientY = 0;
    this.curClientX = 0;
    this.curClientY = 0;

    this.preview = buildPreview(scene);

    dom.addEventListener('mousedown', (e) => this.#onDown(e));
    addEventListener('mousemove', (e) => this.#onMove(e));
    addEventListener('mouseup', (e) => this.#onUp(e));
  }

  /** @param {MouseEvent} e */
  #onDown(e) {
    if (e.button !== 2) return;
    const ids = [...this.getSelectedCows()];
    if (ids.length === 0) return;
    const tile = this.#pickTile(e);
    if (!tile) return;
    this.rmbDown = true;
    this.shiftAtDown = e.shiftKey;
    this.startTile = tile;
    this.startClientX = e.clientX;
    this.startClientY = e.clientY;
    this.curClientX = e.clientX;
    this.curClientY = e.clientY;
  }

  /** @param {MouseEvent} e */
  #onMove(e) {
    if (!this.rmbDown) return;
    this.curClientX = e.clientX;
    this.curClientY = e.clientY;
    this.#updatePreview(e);
  }

  /** @param {MouseEvent} e */
  #onUp(e) {
    if (!this.rmbDown || e.button !== 2) return;
    this.rmbDown = false;
    this.#hidePreview();
    const start = this.startTile;
    this.startTile = null;
    if (!start) return;

    const ids = [...this.getSelectedCows()];
    if (ids.length === 0) return;

    const dx = e.clientX - this.startClientX;
    const dy = e.clientY - this.startClientY;
    const dragged = dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;

    // Single-cow click (not drag) → open the context menu instead of moving
    // immediately. Multi-cow and drag fall through to the existing batch
    // move so rallying a squad keeps the fast flow.
    if (!dragged && ids.length === 1) {
      this.#openContextMenu(e, start, ids[0]);
      return;
    }

    const endTile = dragged ? (this.#pickTile(e) ?? start) : start;

    const targets =
      dragged && ids.length > 1
        ? lineTargets(this.tileGrid, this.walkable, start, endTile, ids.length)
        : spreadTargets(this.tileGrid, this.walkable, endTile, ids.length);

    const assignment = matchCowsToTargets(this.world, ids, targets, this.tileGrid);
    let issued = 0;
    for (let k = 0; k < ids.length; k++) {
      const t = assignment[k];
      if (t < 0) continue;
      if (this.#issue(ids[k], targets[t], this.shiftAtDown)) issued++;
    }
    if (issued > 0) this.audio?.play('command');
    else this.audio?.play('deny');
  }

  /**
   * @param {MouseEvent} e
   * @param {{ i: number, j: number }} tile
   * @param {number} cowId
   */
  #openContextMenu(e, tile, cowId) {
    const shift = this.shiftAtDown;
    /** @type {{ label: string, onPick?: () => void, disabled?: boolean }[]} */
    const items = [
      {
        label: 'Move here',
        onPick: () => {
          const endTile = spreadTargets(this.tileGrid, this.walkable, tile, 1)[0] ?? tile;
          if (this.#issue(cowId, endTile, shift)) this.audio?.play('command');
          else this.audio?.play('deny');
        },
      },
    ];
    // Skip prioritize options for drafted cows — the brain strips non-move
    // jobs off drafted cows every tick, so prioritizing anything else would
    // silently revert. "Move here" still works because it posts a move job.
    const cow = this.world.get(cowId, 'Cow');
    if (!cow?.drafted) {
      const jobs = findPrioritizableJobsAtTile(this.board, tile.i, tile.j);
      for (const job of jobs) {
        items.push({
          label: `Prioritize ${jobVerbForPrioritize(job.kind)}`,
          onPick: () => {
            if (prioritizeJob(this.world, this.board, job.id, cowId)) this.audio?.play('command');
            else this.audio?.play('deny');
          },
        });
      }
      // Haulable stack with no haul job posted → the poster couldn't find a
      // stockpile slot (no stockpile built, or all same-kind piles full).
      // Tell the player why nothing's happening instead of silently showing
      // just "Move here".
      if (!jobs.some((j) => j.kind === 'haul' || j.kind === 'deliver')) {
        if (this.#tileHasHaulableStack(tile.i, tile.j)) {
          items.push({ label: 'No stockpile available to haul to', disabled: true });
        }
      }
    }
    this.contextMenu.show(e.clientX, e.clientY, items);
  }

  /**
   * True when (i, j) hosts an Item entity that the haul poster would try to
   * move: loose (not on a stockpile tile), unforbidden.
   *
   * @param {number} i @param {number} j
   */
  #tileHasHaulableStack(i, j) {
    if (this.tileGrid.isStockpile(i, j)) return false;
    for (const { components } of this.world.query(['Item', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i !== i || a.j !== j) continue;
      if (components.Item.forbidden) continue;
      return true;
    }
    return false;
  }

  /** @param {MouseEvent} e */
  #updatePreview(e) {
    const ids = [...this.getSelectedCows()];
    const dx = e.clientX - this.startClientX;
    const dy = e.clientY - this.startClientY;
    const dragged = dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
    if (!dragged || ids.length < 2 || !this.startTile) {
      this.#hidePreview();
      return;
    }
    const endTile = this.#pickTile(e);
    if (!endTile) {
      this.#hidePreview();
      return;
    }
    const targets = lineTargets(this.tileGrid, this.walkable, this.startTile, endTile, ids.length);
    this.#renderPreview(this.startTile, endTile, targets);
  }

  /**
   * @param {{ i: number, j: number }} start
   * @param {{ i: number, j: number }} end
   * @param {{ i: number, j: number }[]} targets
   */
  #renderPreview(start, end, targets) {
    const grid = this.tileGrid;
    const startW = tileToWorld(start.i, start.j, grid.W, grid.H);
    const endW = tileToWorld(end.i, end.j, grid.W, grid.H);
    const y0 = grid.getElevation(start.i, start.j) + PREVIEW_GROUND_CLEARANCE;
    const y1 = grid.getElevation(end.i, end.j) + PREVIEW_GROUND_CLEARANCE;

    const p = this.preview;
    p.linePositions[0] = startW.x;
    p.linePositions[1] = y0;
    p.linePositions[2] = startW.z;
    p.linePositions[3] = endW.x;
    p.linePositions[4] = y1;
    p.linePositions[5] = endW.z;
    p.lineGeo.attributes.position.needsUpdate = true;
    p.line.visible = true;

    const nMarkers = Math.min(targets.length, PREVIEW_MARKER_CAPACITY);
    for (let k = 0; k < nMarkers; k++) {
      const t = targets[k];
      const w = tileToWorld(t.i, t.j, grid.W, grid.H);
      const y = grid.getElevation(t.i, t.j) + PREVIEW_GROUND_CLEARANCE;
      const off = k * 8 * 3;
      const E = [w.x + PREVIEW_MARKER_RADIUS, y, w.z];
      const N = [w.x, y, w.z - PREVIEW_MARKER_RADIUS];
      const W_ = [w.x - PREVIEW_MARKER_RADIUS, y, w.z];
      const S = [w.x, y, w.z + PREVIEW_MARKER_RADIUS];
      writeSeg(p.markerPositions, off, E, N);
      writeSeg(p.markerPositions, off + 6, N, W_);
      writeSeg(p.markerPositions, off + 12, W_, S);
      writeSeg(p.markerPositions, off + 18, S, E);
    }
    p.markerGeo.attributes.position.needsUpdate = true;
    p.markerGeo.setDrawRange(0, nMarkers * 8);
    p.markers.visible = nMarkers > 0;
  }

  #hidePreview() {
    this.preview.line.visible = false;
    this.preview.markers.visible = false;
  }

  /**
   * @param {MouseEvent} e
   * @returns {{ i: number, j: number } | null}
   */
  #pickTile(e) {
    const rect = this.dom.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(_ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.getTileMesh(), false);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    const tile = worldToTile(p.x, p.z, this.tileGrid.W, this.tileGrid.H);
    if (tile.i < 0) return null;
    return tile;
  }

  /**
   * @param {number} id
   * @param {{ i: number, j: number }} goal
   * @param {boolean} shiftKey
   * @returns {boolean} true if a path was issued
   */
  #issue(id, goal, shiftKey) {
    const pos = this.world.get(id, 'Position');
    const path = this.world.get(id, 'Path');
    const job = this.world.get(id, 'Job');
    if (!pos || !path || !job) return false;

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
        return false;
      }
      for (let k = 1; k < leg.length; k++) path.steps.push(leg[k]);
      existingLegEnds.push(path.steps.length - 1);
      existingWaypoints.push(goal);
      job.payload.waypoints = existingWaypoints;
      job.payload.legEnds = existingLegEnds;
      return true;
    }

    const start = worldToTileClamp(pos.x, pos.z, this.tileGrid.W, this.tileGrid.H);
    const route = this.pathCache.find(start, goal);
    if (!route || route.length === 0) {
      console.log('[move] no path to', goal, 'for cow', id);
      return false;
    }
    path.steps = route;
    path.index = 0;
    job.kind = 'move';
    job.state = 'moving';
    job.payload = { waypoints: [goal], legEnds: [route.length - 1] };
    return true;
  }
}

/**
 * @param {THREE.Scene} scene
 */
function buildPreview(scene) {
  const lineGeo = new THREE.BufferGeometry();
  const linePositions = new Float32Array(6);
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: PREVIEW_COLOR }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);

  const markerGeo = new THREE.BufferGeometry();
  const markerPositions = new Float32Array(PREVIEW_MARKER_CAPACITY * 8 * 3);
  markerGeo.setAttribute('position', new THREE.BufferAttribute(markerPositions, 3));
  markerGeo.setDrawRange(0, 0);
  const markers = new THREE.LineSegments(
    markerGeo,
    new THREE.LineBasicMaterial({ color: PREVIEW_COLOR }),
  );
  markers.frustumCulled = false;
  markers.visible = false;
  scene.add(markers);

  return { line, lineGeo, linePositions, markers, markerGeo, markerPositions };
}

/**
 * @param {Float32Array} out @param {number} off
 * @param {number[]} a @param {number[]} b
 */
function writeSeg(out, off, a, b) {
  out[off] = a[0];
  out[off + 1] = a[1];
  out[off + 2] = a[2];
  out[off + 3] = b[0];
  out[off + 4] = b[1];
  out[off + 5] = b[2];
}

/**
 * BFS outward from `goal` to pick `count` distinct walkable tiles near it.
 * Caller guarantees `goal` is in-bounds; if `goal` itself isn't walkable,
 * the search still radiates outward and picks the nearest walkable ones.
 * If we run out of reachable walkable tiles, remaining slots fall back to
 * `goal` so the caller always gets `count` entries.
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
  const size = grid.W * grid.H;
  if (_bfsScratch.length < size) _bfsScratch = new Uint8Array(size);
  const seen = _bfsScratch;
  seen.fill(0, 0, size);
  /** @type {{ i: number, j: number }[]} */
  const queue = [{ i: goal.i, j: goal.j }];
  seen[goal.j * grid.W + goal.i] = 1;
  let head = 0;
  while (out.length < count && head < queue.length) {
    const t = queue[head++];
    if (walkable(grid, t.i, t.j)) out.push(t);
    for (const [di, dj] of NBRS) {
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

/**
 * Pick `count` distinct walkable tiles evenly spaced along the line from
 * `start` to `end`. Each interpolated point is snapped to its nearest
 * unreserved walkable tile (BFS radiates out), so drags across unwalkable
 * terrain still produce usable assignments.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {{ i: number, j: number }} start
 * @param {{ i: number, j: number }} end
 * @param {number} count
 * @returns {{ i: number, j: number }[]}
 */
function lineTargets(grid, walkable, start, end, count) {
  /** @type {{ i: number, j: number }[]} */
  const out = [];
  const reserved = new Uint8Array(grid.W * grid.H);
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 1 : k / (count - 1);
    const ri = Math.round(start.i + (end.i - start.i) * t);
    const rj = Math.round(start.j + (end.j - start.j) * t);
    const picked = nearestWalkable(grid, walkable, ri, rj, reserved);
    reserved[picked.j * grid.W + picked.i] = 1;
    out.push(picked);
  }
  return out;
}

/**
 * BFS from (i, j) outward, returning the first walkable tile not already in
 * `reserved`. Falls back to the clamped seed tile if nothing suitable is
 * reachable within the grid.
 *
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {(grid: import('../world/tileGrid.js').TileGrid, i: number, j: number) => boolean} walkable
 * @param {number} i @param {number} j
 * @param {Uint8Array} reserved
 * @returns {{ i: number, j: number }}
 */
function nearestWalkable(grid, walkable, i, j, reserved) {
  const ci = Math.max(0, Math.min(grid.W - 1, i));
  const cj = Math.max(0, Math.min(grid.H - 1, j));
  const size = grid.W * grid.H;
  if (_bfsScratch.length < size) _bfsScratch = new Uint8Array(size);
  const seen = _bfsScratch;
  seen.fill(0, 0, size);
  const queue = [{ i: ci, j: cj }];
  seen[cj * grid.W + ci] = 1;
  let head = 0;
  while (head < queue.length) {
    const t = queue[head++];
    const idx = t.j * grid.W + t.i;
    if (!reserved[idx] && walkable(grid, t.i, t.j)) return t;
    for (const [di, dj] of NBRS) {
      const ni = t.i + di;
      const nj = t.j + dj;
      if (ni < 0 || ni >= grid.W || nj < 0 || nj >= grid.H) continue;
      const k = nj * grid.W + ni;
      if (seen[k]) continue;
      seen[k] = 1;
      queue.push({ i: ni, j: nj });
    }
  }
  return { i: ci, j: cj };
}

/**
 * Greedy assignment: for every (cow, target) pair compute the squared
 * world-space distance, sort ascending, then walk the list claiming the
 * closest still-unclaimed pair each time. Runs O(n² log n) on the triple
 * list; n ≤ selection size so it's cheap. Returns an array `a` where
 * `a[k]` = index into `targets` for cow `ids[k]`, or `-1` if that cow had
 * no Position component and gets skipped.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {number[]} ids
 * @param {{ i: number, j: number }[]} targets
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {number[]}
 */
function matchCowsToTargets(world, ids, targets, grid) {
  const nc = ids.length;
  const nt = targets.length;
  const cowXY = /** @type {({ x: number, z: number } | null)[]} */ (new Array(nc));
  for (let k = 0; k < nc; k++) {
    const pos = world.get(ids[k], 'Position');
    cowXY[k] = pos ? { x: pos.x, z: pos.z } : null;
  }
  const tgtXY = targets.map((t) => tileToWorld(t.i, t.j, grid.W, grid.H));

  /** @type {{ c: number, t: number, d2: number }[]} */
  const triples = [];
  for (let c = 0; c < nc; c++) {
    const cp = cowXY[c];
    if (!cp) continue;
    for (let t = 0; t < nt; t++) {
      const tp = tgtXY[t];
      const dx = cp.x - tp.x;
      const dz = cp.z - tp.z;
      triples.push({ c, t, d2: dx * dx + dz * dz });
    }
  }
  triples.sort((a, b) => a.d2 - b.d2);

  const cowTaken = new Array(nc).fill(false);
  const tgtTaken = new Array(nt).fill(false);
  const out = new Array(nc).fill(-1);
  for (const { c, t } of triples) {
    if (cowTaken[c] || tgtTaken[t]) continue;
    cowTaken[c] = true;
    tgtTaken[t] = true;
    out[c] = t;
  }
  return out;
}

const NBRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
