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
 * Default walkability: every tile is walkable. Replace later when terrain
 * has solid biomes / structures.
 * @param {TileGrid} _grid @param {number} _i @param {number} _j
 */
export function defaultWalkable(_grid, _i, _j) {
  return true;
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

  const gScore = new Float32Array(W * H);
  const fScore = new Float32Array(W * H);
  const cameFrom = new Int32Array(W * H);
  const closed = new Uint8Array(W * H);
  gScore.fill(Number.POSITIVE_INFINITY);
  fScore.fill(Number.POSITIVE_INFINITY);
  cameFrom.fill(-1);

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
 * Memoizes findPath results keyed by (start,goal). Walkability changes invalidate
 * the whole cache via `clear()` — fine-grained invalidation comes later.
 */
export class PathCache {
  /**
   * @param {TileGrid} grid
   * @param {(grid: TileGrid, i: number, j: number) => boolean} [walkable]
   */
  constructor(grid, walkable = defaultWalkable) {
    this.grid = grid;
    this.walkable = walkable;
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
    if (this.cache.has(key)) {
      this.hits++;
      return this.cache.get(key) ?? null;
    }
    this.misses++;
    const p = findPath(this.grid, start, goal, this.walkable);
    this.cache.set(key, p);
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
