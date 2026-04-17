/**
 * A* pathfinding on a TileGrid with 8-directional movement.
 *
 * Cost: 1 per cardinal step, √2 per diagonal. Heuristic: octile distance.
 * Diagonal moves require both adjacent cardinals to be walkable (no corner-cutting
 * through diagonal walls) — important once we add solid tiles.
 *
 * `PathCache` memoizes (start,goal) → path. Prefer `invalidateTile(i, j)` on
 * localized walkability changes (a single chop/mine/wall) so we only evict
 * paths actually affected. `clear()` is still available for catastrophic
 * invalidation (full regen, load).
 */

import { BIOME, TileGrid } from '../world/tileGrid.js';

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
 * Default walkability: tile must be in-bounds, not in the occupancy array
 * (trees/rocks), not flagged as a finished wall, and not deep water. Shallow
 * water is walkable — cows wade across it at reduced speed (see cow.js).
 * BuildSites deliberately do NOT block — haulers walk onto them to deliver
 * materials — only the erected Wall does.
 * @param {TileGrid} grid @param {number} i @param {number} j
 */
export function defaultWalkable(grid, i, j) {
  if (!grid.inBounds(i, j)) return false;
  const k = grid.idx(i, j);
  if (grid.biome[k] === BIOME.DEEP_WATER) return false;
  return grid.occupancy[k] === 0 && grid.wall[k] === 0;
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
 * `start.z` and `goal.z` describe the layer index; today A* is single-layer
 * only — cross-layer pathing lands when ramps exist, so start.z must equal
 * goal.z here. `grid` must be the TileGrid of that shared layer (use
 * `tileWorld.getLayer(z)` to resolve). On layers above ground, every walkable
 * neighbor additionally requires a floor — air tiles are unwalkable.
 *
 * @param {TileGrid} grid
 * @param {{ i: number, j: number, z?: number }} start
 * @param {{ i: number, j: number, z?: number }} goal
 * @param {(grid: TileGrid, i: number, j: number) => boolean} [walkable]
 * @returns {{ i: number, j: number }[] | null}
 */
export function findPath(grid, start, goal, walkable = defaultWalkable) {
  const z = start.z ?? 0;
  if ((goal.z ?? 0) !== z) return null;
  if (!grid.inBounds(start.i, start.j) || !grid.inBounds(goal.i, goal.j)) return null;
  // Layers above ground are walkable only where a floor is built — air is
  // impassable. On z=0 the terrain is the floor so this check is a no-op.
  const passable =
    z === 0
      ? walkable
      : /** @param {TileGrid} g @param {number} i @param {number} j */
        (g, i, j) => walkable(g, i, j) && g.isFloor(i, j);
  // Start-tile walkability is intentionally not gated: the cow is already
  // standing there, so refusing to find a path would leave it stranded if
  // anything ever blocks the tile under it (e.g. a sapling spawning on the
  // cow's grass). Goal still must be walkable.
  if (!passable(grid, goal.i, goal.j)) return null;
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
      if (!passable(grid, ni, nj)) continue;
      // No corner-cutting through solid diagonals.
      if (di !== 0 && dj !== 0) {
        if (!passable(grid, ci + di, cj) || !passable(grid, ci, cj + dj)) continue;
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
 *
 * Walkability changes should flow through `invalidateTile(i, j)`, which uses a
 * reverse index (tile → set of cache keys touching it) to evict only affected
 * entries. One chop used to nuke all 2048 cached paths via `clear()`; now it
 * evicts only the handful that actually stepped near the changed tile.
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
    /**
     * Reverse index: flat tile idx → set of cache keys whose path steps on
     * this tile. Null paths are indexed by their start+goal tiles so that
     * unblocking near either endpoint flushes the stale "no route" entry.
     * @type {Map<number, Set<string>>}
     */
    this.tileIndex = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @param {{ i: number, j: number, z?: number }} start
   * @param {{ i: number, j: number, z?: number }} goal
   * @param {{ cache?: boolean }} [opts] pass { cache: false } for ephemeral
   *   queries (e.g. wander) that would otherwise churn the LRU.
   */
  find(start, goal, opts) {
    if (opts && opts.cache === false) {
      this.misses++;
      return findPath(this.grid, start, goal, this.walkable);
    }
    const sz = start.z ?? 0;
    const gz = goal.z ?? 0;
    const key = `${start.i},${start.j},${sz}|${goal.i},${goal.j},${gz}`;
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
    this.#indexEntry(key, p, start, goal);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.#evictKey(oldest);
    }
    return p;
  }

  /**
   * Evict every cached path that steps on or through a tile in the 3x3
   * neighborhood of (i, j). 3x3 covers both direct-step cases AND diagonal
   * corner-cut cases (a diagonal (a,b)→(a+1,b+1) relies on (a+1,b) and
   * (a,b+1) being walkable — so any of those neighbors changing walkability
   * could invalidate the diagonal, even if the path never stepped on the
   * changed tile itself).
   *
   * @param {number} i @param {number} j @param {number} [z]  defaults to 0
   */
  invalidateTile(i, j, z = 0) {
    // Only the z=0 layer holds paths today; non-zero is a no-op until
    // stacked-floor pathing lands.
    if (z !== 0) return;
    const W = this.grid.W;
    const H = this.grid.H;
    const minI = Math.max(0, i - 1);
    const maxI = Math.min(W - 1, i + 1);
    const minJ = Math.max(0, j - 1);
    const maxJ = Math.min(H - 1, j + 1);
    for (let nj = minJ; nj <= maxJ; nj++) {
      for (let ni = minI; ni <= maxI; ni++) {
        const tileIdx = nj * W + ni;
        const set = this.tileIndex.get(tileIdx);
        if (!set) continue;
        // Snapshot before mutating — #evictKey deindexes and would otherwise
        // mutate the set mid-iteration.
        for (const key of Array.from(set)) this.#evictKey(key);
      }
    }
  }

  clear() {
    this.cache.clear();
    this.tileIndex.clear();
  }

  /**
   * @param {string} key
   * @param {{ i: number, j: number }[] | null} path
   * @param {{ i: number, j: number }} start
   * @param {{ i: number, j: number }} goal
   */
  #indexEntry(key, path, start, goal) {
    const W = this.grid.W;
    if (path === null) {
      this.#addToIndex(start.j * W + start.i, key);
      if (goal.i !== start.i || goal.j !== start.j) {
        this.#addToIndex(goal.j * W + goal.i, key);
      }
      return;
    }
    for (const { i, j } of path) this.#addToIndex(j * W + i, key);
  }

  /** @param {number} tileIdx @param {string} key */
  #addToIndex(tileIdx, key) {
    let set = this.tileIndex.get(tileIdx);
    if (!set) {
      set = new Set();
      this.tileIndex.set(tileIdx, set);
    }
    set.add(key);
  }

  /** @param {string} key */
  #evictKey(key) {
    const path = this.cache.get(key);
    if (path === undefined) return;
    this.cache.delete(key);
    this.#deindexEntry(key, path);
  }

  /**
   * @param {string} key
   * @param {{ i: number, j: number }[] | null} path
   */
  #deindexEntry(key, path) {
    const W = this.grid.W;
    if (path === null) {
      // Recover start/goal from the key — null-path entries never carry their
      // own path array, so the key is the only source of tile coords. Key
      // shape: "si,sj,sz|gi,gj,gz". Layer indexing lands with stacked paths.
      const [s, g] = key.split('|');
      const [si, sj] = s.split(',');
      const [gi, gj] = g.split(',');
      this.#removeFromIndex(Number(sj) * W + Number(si), key);
      this.#removeFromIndex(Number(gj) * W + Number(gi), key);
      return;
    }
    for (const { i, j } of path) this.#removeFromIndex(j * W + i, key);
  }

  /** @param {number} tileIdx @param {string} key */
  #removeFromIndex(tileIdx, key) {
    const set = this.tileIndex.get(tileIdx);
    if (!set) return;
    set.delete(key);
    if (set.size === 0) this.tileIndex.delete(tileIdx);
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
