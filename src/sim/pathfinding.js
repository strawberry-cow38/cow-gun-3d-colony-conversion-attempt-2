/**
 * A* pathfinding on a TileGrid with 8-directional movement.
 *
 * Cost: 1 per cardinal step, √2 per diagonal. Heuristic: octile distance.
 * Diagonal moves require both adjacent cardinals to be walkable (no corner-cutting
 * through diagonal walls) — important once we add solid tiles.
 *
 * `PathCache` memoizes (start,goal) → path. Invalidate the entire cache when
 * walkability changes by calling `clear()`. The job system or terrain editor
 * should fire a 'pathfind' dirty tag and a small system can call `clear()`.
 */

import { TileGrid } from '../world/tileGrid.js';

const SQRT2 = Math.SQRT2;

/** 8 neighbor offsets: (di, dj, cost). */
const NEIGHBORS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/**
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by
 */
function octile(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * Default walkability: tile must be in-bounds and not marked blocked in the
 * grid's occupancy array (trees, rocks, buildings). Biome-based walls come
 * later when we add e.g. lava/water.
 * @param {TileGrid} grid @param {number} i @param {number} j
 */
export function defaultWalkable(grid, i, j) {
  if (!grid.inBounds(i, j)) return false;
  return grid.occupancy[grid.idx(i, j)] === 0;
}

// Module-scoped scratch buffers sized to the largest grid we've seen so far.
// findPath reuses them between calls so we don't allocate ~480KB per pathfind
// on a 200x200 grid (4 typed arrays × 40k cells × 4-8 bytes).
/** @type {Float32Array | null} */ let _gScore = null;
/** @type {Float32Array | null} */ let _fScore = null;
/** @type {Int32Array | null} */ let _cameFrom = null;
/** @type {Uint8Array | null} */ let _closed = null;
let _scratchSize = 0;

/**
 * @param {number} size
 */
function ensureScratch(size) {
  if (_scratchSize >= size) return;
  _gScore = new Float32Array(size);
  _fScore = new Float32Array(size);
  _cameFrom = new Int32Array(size);
  _closed = new Uint8Array(size);
  _scratchSize = size;
}

/**
 * A* on a TileGrid. Returns array of {i,j} from start (inclusive) to goal
 * (inclusive), or null if no path.
 *
 * @param {TileGrid} grid
 * @param {{ i: number, j: number }} start
 * @param {{ i: number, j: number }} goal
 * @param {(grid: TileGrid, i: number, j: number) => boolean} [walkable]
 * @returns {{ i: number, j: number }[] | null}
 */
export function findPath(grid, start, goal, walkable = defaultWalkable) {
  if (!grid.inBounds(start.i, start.j) || !grid.inBounds(goal.i, goal.j)) return null;
  if (!walkable(grid, start.i, start.j) || !walkable(grid, goal.i, goal.j)) return null;
  if (start.i === goal.i && start.j === goal.j) return [{ i: start.i, j: start.j }];

  const W = grid.W;
  const H = grid.H;
  const startIdx = start.j * W + start.i;
  const goalIdx = goal.j * W + goal.i;

  ensureScratch(W * H);
  const gScore = /** @type {Float32Array} */ (_gScore);
  const fScore = /** @type {Float32Array} */ (_fScore);
  const cameFrom = /** @type {Int32Array} */ (_cameFrom);
  const closed = /** @type {Uint8Array} */ (_closed);
  // Fill only the region we'll touch for this grid size.
  const cells = W * H;
  for (let k = 0; k < cells; k++) {
    gScore[k] = Number.POSITIVE_INFINITY;
    fScore[k] = Number.POSITIVE_INFINITY;
    cameFrom[k] = -1;
    closed[k] = 0;
  }

  gScore[startIdx] = 0;
  fScore[startIdx] = octile(start.i, start.j, goal.i, goal.j);

  const open = new MinHeap();
  open.push(startIdx, fScore[startIdx]);

  while (open.size > 0) {
    const current = open.pop();
    if (current === goalIdx) {
      const path = [];
      let n = current;
      while (n !== -1) {
        path.push({ i: n % W, j: Math.floor(n / W) });
        n = cameFrom[n];
      }
      path.reverse();
      return path;
    }
    if (closed[current]) continue;
    closed[current] = 1;

    const ci = current % W;
    const cj = Math.floor(current / W);

    for (const [di, dj, cost] of NEIGHBORS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nIdx = nj * W + ni;
      if (closed[nIdx]) continue;
      if (!walkable(grid, ni, nj)) continue;
      // No corner-cutting through solid diagonals.
      if (di !== 0 && dj !== 0) {
        if (!walkable(grid, ci + di, cj) || !walkable(grid, ci, cj + dj)) continue;
      }
      const tentative = gScore[current] + cost;
      if (tentative < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentative;
        fScore[nIdx] = tentative + octile(ni, nj, goal.i, goal.j);
        open.push(nIdx, fScore[nIdx]);
      }
    }
  }

  return null;
}

/**
 * Memoizes findPath results keyed by (start,goal), capped LRU so a long
 * session with lots of distinct wanders doesn't grow the cache forever.
 * Walkability changes invalidate the whole cache via `clear()` — fine-grained
 * invalidation comes later.
 */
export class PathCache {
  /**
   * @param {TileGrid} grid
   * @param {(grid: TileGrid, i: number, j: number) => boolean} [walkable]
   * @param {{ capacity?: number }} [opts]
   */
  constructor(grid, walkable = defaultWalkable, opts = {}) {
    this.grid = grid;
    this.walkable = walkable;
    this.capacity = opts.capacity ?? 2048;
    /** @type {Map<string, { i: number, j: number }[] | null>} */
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @param {{ i: number, j: number }} start
   * @param {{ i: number, j: number }} goal
   */
  find(start, goal) {
    const key = `${start.i},${start.j}|${goal.i},${goal.j}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      // Touch: Map preserves insertion order, so delete+set re-inserts at the
      // tail making this a cheap LRU without a separate linked list.
      this.cache.delete(key);
      this.cache.set(key, hit);
      this.hits++;
      return hit ?? null;
    }
    this.misses++;
    const p = findPath(this.grid, start, goal, this.walkable);
    this.cache.set(key, p);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return p;
  }

  clear() {
    this.cache.clear();
  }
}

/**
 * Tiny binary min-heap of (idx, priority). Ties are broken by insertion order
 * (FIFO) which keeps A* paths visually consistent across runs.
 */
class MinHeap {
  constructor() {
    /** @type {number[]} */
    this.idx = [];
    /** @type {number[]} */
    this.pri = [];
  }
  get size() {
    return this.idx.length;
  }
  /** @param {number} idx @param {number} priority */
  push(idx, priority) {
    this.idx.push(idx);
    this.pri.push(priority);
    this.#bubbleUp(this.idx.length - 1);
  }
  /** @returns {number} */
  pop() {
    const top = this.idx[0];
    const lastIdx = this.idx.pop();
    const lastPri = this.pri.pop();
    if (this.idx.length > 0) {
      this.idx[0] = /** @type {number} */ (lastIdx);
      this.pri[0] = /** @type {number} */ (lastPri);
      this.#sinkDown(0);
    }
    return top;
  }
  /** @param {number} startIdx */
  #bubbleUp(startIdx) {
    let i = startIdx;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[i] < this.pri[parent]) {
        [this.pri[i], this.pri[parent]] = [this.pri[parent], this.pri[i]];
        [this.idx[i], this.idx[parent]] = [this.idx[parent], this.idx[i]];
        i = parent;
      } else break;
    }
  }
  /** @param {number} startIdx */
  #sinkDown(startIdx) {
    let i = startIdx;
    const n = this.pri.length;
    while (true) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < n && this.pri[l] < this.pri[smallest]) smallest = l;
      if (r < n && this.pri[r] < this.pri[smallest]) smallest = r;
      if (smallest === i) break;
      [this.pri[i], this.pri[smallest]] = [this.pri[smallest], this.pri[i]];
      [this.idx[i], this.idx[smallest]] = [this.idx[smallest], this.idx[i]];
      i = smallest;
    }
  }
}
