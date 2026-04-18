/**
 * A* pathfinding on a TileGrid with 8-directional movement.
 *
 * Cost: 1 per cardinal step, √2 per diagonal. Heuristic: octile distance.
 * Diagonal moves require both adjacent cardinals to be walkable (no corner-cutting
 * through diagonal walls) — important once we add solid tiles.
 *
 * Multi-layer: when the first arg is a `TileWorld` with stacked layers,
 * neighbor expansion additionally follows ramps. A ramp bit on layer z at
 * (i,j) creates a vertical edge to (i,j,z+1) (and back), and its footprint
 * counts as an implicit floor on layer z+1 — so upper-layer tiles are
 * walkable either via a placed floor OR a ramp poking up from below. Raw
 * `TileGrid` callers get today's single-layer behavior unchanged.
 *
 * `PathCache` memoizes (start,goal) → path. Prefer `invalidateTile(i, j)` on
 * localized walkability changes (a single chop/mine/wall) so we only evict
 * paths actually affected. `clear()` is still available for catastrophic
 * invalidation (full regen, load).
 */

import { BIOME, LAYER_HEIGHT, TERRAIN_STEP, TileGrid, WALL_FILL_FULL } from '../world/tileGrid.js';
/** @typedef {import('../world/tileWorld.js').TileWorld} TileWorld */

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
 * Cliff-climb rules. TERRAIN_STEP is the vertical resolution (0.75m).
 *  - Flat or sub-one-step moves: free.
 *  - Cardinal neighbours one step (0.75m) higher or lower: hop — allowed
 *    with a small extra cost so a ramp is preferred when both routes exist.
 *  - Cardinal neighbours two steps (1.5m) higher or lower: climb — allowed
 *    but very slow (10% speed, reflected here as a 10× cost multiplier) so
 *    the planner will route the long way around if anything remotely
 *    comparable exists, and cows emerge from the climb treating it as
 *    "much worse than a ramp".
 *  - Anything above two steps: blocked. A proper Z-layer crossing needs a
 *    ramp.
 *  - Diagonals with any elevation change: blocked. Visually a diagonal hop
 *    over a corner looks wrong and the cardinal neighbours already cover
 *    that traversal.
 */
const HOP_EPS = TERRAIN_STEP * 0.5;
const HOP_MAX = TERRAIN_STEP * 1.5;
const CLIMB_MAX = TERRAIN_STEP * 2.5;
const HOP_EXTRA_COST = 0.3;
const CLIMB_COST_MULT = 10;
/**
 * Multiplier applied to the step cost when the neighbour tile is shallow
 * water. 5× means a dry detour up to ~5 tiles longer still beats wading one
 * tile straight through, which matches how much slower cows move in water
 * (15% speed in cow.js).
 */
const SHALLOW_WATER_COST = 5;

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
 * (trees/rocks), not topped by a full-height wall, and not deep water. Partial
 * walls (quarter/half, fill 1-2) do NOT block — cows hop/climb over them via
 * the cliff-climb rules using their fill as effective elevation. Shallow water
 * is walkable — cows wade across it at reduced speed (see cow.js). BuildSites
 * deliberately do NOT block — haulers walk onto them to deliver materials.
 * @param {TileGrid} grid @param {number} i @param {number} j
 */
export function defaultWalkable(grid, i, j) {
  if (!grid.inBounds(i, j)) return false;
  const k = grid.idx(i, j);
  if (grid.biome[k] === BIOME.DEEP_WATER) return false;
  if (grid.occupancy[k] !== 0) return false;
  return grid.wall[k] < WALL_FILL_FULL;
}

/**
 * Elevation of the standing surface at (i, j, z). Terrain only lives on the
 * ground layer — upper layers keep their own grids but share the ground's
 * heightmap — so terrain always comes from `layer0`. Each layer owns its own
 * wall array, and fill adds TERRAIN_STEP per quarter on top. Callers pass
 * the resolved `layer` (world.layers[z] when multi-layer, else layer0).
 *
 * Used for cross-layer cliff-climb checks: stepping from a partial-wall top
 * on z=0 onto a full wall's top surface at z=1 is physically a single hop,
 * but the two points sit on different layer grids, so the elevation math
 * has to reconcile the layer offset + terrain explicitly.
 *
 * @param {TileGrid} layer0 @param {TileGrid} layer
 * @param {number} i @param {number} j @param {number} z
 */
function totalElevation(layer0, layer, i, j, z) {
  return layer0.getElevation(i, j) + z * LAYER_HEIGHT + layer.wall[layer.idx(i, j)] * TERRAIN_STEP;
}

/**
 * Multi-layer passability: tile (i,j,z) is walkable if its own layer passes
 * the base walkable check AND the tile has support from below (floor on same
 * layer, or a ramp/wall on the layer below). Mirrors the inline rule inside
 * findPath so job-posting code can pick stand-tiles that the pathfinder will
 * actually accept.
 *
 * @param {TileGrid | TileWorld} gridOrWorld
 * @param {number} i @param {number} j @param {number} z
 * @param {(grid: TileGrid, i: number, j: number) => boolean} [walkable]
 */
export function passableAt(gridOrWorld, i, j, z, walkable = defaultWalkable) {
  const world = Array.isArray(/** @type {any} */ (gridOrWorld).layers)
    ? /** @type {TileWorld} */ (gridOrWorld)
    : null;
  const g = /** @type {TileGrid} */ (world ? world.layers[z] : gridOrWorld);
  if (!g) return false;
  if (!walkable(g, i, j)) return false;
  if (z === 0) return true;
  if (g.isFloor(i, j)) return true;
  if (!world) return false;
  const below = world.layers[z - 1];
  if (!below) return false;
  if (below.isRamp(i, j)) return true;
  return below.isFullWall(i, j);
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
 * A* over a TileGrid (single-layer) or a TileWorld (stacked layers, cross-
 * layer via ramps). Returns array of `{i,j}` (grid input) or `{i,j,z}` (world
 * input) from start (inclusive) to goal (inclusive), or null if no path.
 *
 * `start.z` / `goal.z` pick the layer. Single-layer: they must match; z>0 is
 * still respected via the upper-layer floor rule (air unwalkable, placed
 * floors walkable). Multi-layer: any in-range z is valid and ramps let the
 * plan move between layers.
 *
 * @param {TileGrid | TileWorld} gridOrWorld
 * @param {{ i: number, j: number, z?: number }} start
 * @param {{ i: number, j: number, z?: number }} goal
 * @param {(grid: TileGrid, i: number, j: number) => boolean} [walkable]
 * @returns {{ i: number, j: number, z?: number }[] | null}
 */
export function findPath(gridOrWorld, start, goal, walkable = defaultWalkable) {
  const world = Array.isArray(/** @type {any} */ (gridOrWorld).layers)
    ? /** @type {TileWorld} */ (gridOrWorld)
    : null;
  const layer0 = /** @type {TileGrid} */ (world ? world.layers[0] : gridOrWorld);
  const depth = world ? world.layers.length : 1;
  const W = layer0.W;
  const H = layer0.H;
  const layerSize = W * H;

  const sz = start.z ?? 0;
  const gz = goal.z ?? 0;

  // Single-layer input doesn't know about other layers, so cross-z goals
  // don't make sense — reject rather than pretend. Multi-layer bounds-checks
  // against the actual stack.
  if (world) {
    if (sz < 0 || sz >= depth || gz < 0 || gz >= depth) return null;
  } else if (sz !== gz) {
    return null;
  }
  if (!layer0.inBounds(start.i, start.j) || !layer0.inBounds(goal.i, goal.j)) return null;

  /** @param {number} z */
  const layerAt = (z) => (world ? world.layers[z] : layer0);

  /** @param {number} i @param {number} j @param {number} z */
  const passable = (i, j, z) => {
    const g = layerAt(z);
    if (!walkable(g, i, j)) return false;
    if (z === 0) return true;
    if (g.isFloor(i, j)) return true;
    if (world) {
      const below = world.layers[z - 1];
      if (below?.isRamp(i, j)) return true;
      // Wall-top walkability: a finished full-height wall on the layer below
      // provides a solid surface to stand on at (i, j, z). Partial walls
      // (quarter/half) don't reach the layer ceiling so they don't support a
      // cow standing on the layer above.
      if (below?.isFullWall(i, j)) return true;
      return false;
    }
    // Raw TileGrid with z>0: no stack to ask, floor is the only lift.
    return false;
  };

  // Start-tile walkability is intentionally not gated: the cow is already
  // standing there, so refusing to find a path would leave it stranded if
  // anything ever blocks the tile under it (e.g. a sapling spawning on the
  // cow's grass). Goal still must be walkable.
  if (!passable(goal.i, goal.j, gz)) return null;
  if (start.i === goal.i && start.j === goal.j && sz === gz) {
    return world ? [{ i: start.i, j: start.j, z: sz }] : [{ i: start.i, j: start.j }];
  }

  // Single-layer callers may pass z>0 (e.g. "this is the upper floor"), but
  // the scratch is only layerSize wide — pack everything into z=0 of the flat
  // buffer. Multi-layer uses the real z. The logical z still flows through
  // passable() so the upper-floor rule applies in both modes.
  const flatCells = layerSize * depth;
  /** @param {number} z */
  const flatZ = (z) => (world ? z : 0);
  const startIdx = flatZ(sz) * layerSize + start.j * W + start.i;
  const goalIdx = flatZ(gz) * layerSize + goal.j * W + goal.i;

  ensureScratch(flatCells);
  const gScore = /** @type {Float32Array} */ (_gScore);
  const fScore = /** @type {Float32Array} */ (_fScore);
  const cameFrom = /** @type {Int32Array} */ (_cameFrom);
  const closed = /** @type {Uint8Array} */ (_closed);
  for (let k = 0; k < flatCells; k++) {
    gScore[k] = Number.POSITIVE_INFINITY;
    fScore[k] = Number.POSITIVE_INFINITY;
    cameFrom[k] = -1;
    closed[k] = 0;
  }

  gScore[startIdx] = 0;
  fScore[startIdx] = octile(start.i, start.j, goal.i, goal.j);

  const open = new MinHeap();
  open.push(startIdx, fScore[startIdx]);

  /** @param {number} nIdx @param {number} ni @param {number} nj @param {number} nz @param {number} currentIdx @param {number} stepCost */
  const relax = (nIdx, ni, nj, nz, currentIdx, stepCost) => {
    if (closed[nIdx]) return;
    const tentative = gScore[currentIdx] + stepCost;
    if (tentative < gScore[nIdx]) {
      cameFrom[nIdx] = currentIdx;
      gScore[nIdx] = tentative;
      fScore[nIdx] = tentative + octile(ni, nj, goal.i, goal.j);
      open.push(nIdx, fScore[nIdx]);
    }
  };

  while (open.size > 0) {
    const current = open.pop();
    if (current === goalIdx) {
      const path = [];
      let n = current;
      while (n !== -1) {
        const pzFlat = Math.floor(n / layerSize);
        const r = n - pzFlat * layerSize;
        const i = r % W;
        const j = (r - i) / W;
        path.push(world ? { i, j, z: pzFlat } : { i, j });
        n = cameFrom[n];
      }
      path.reverse();
      return path;
    }
    if (closed[current]) continue;
    closed[current] = 1;

    const czFlat = Math.floor(current / layerSize);
    const cr = current - czFlat * layerSize;
    const ci = cr % W;
    const cj = (cr - ci) / W;
    // Logical z drives the floor/ramp rule in passable; flat z indexes the
    // scratch buffer. Single-layer packs everything into flat z=0 while
    // logical z stays at sz so "above-ground" semantics still apply.
    const cz = world ? czFlat : sz;

    // 8 horizontal neighbors. Same-layer step is the common case; when it
    // rejects and the step is cardinal we probe z±1 so a cow can step onto a
    // wall top or drop onto a partial wall. Diagonals stay single-layer.
    const curLayer = layerAt(cz);
    const curFullEl = totalElevation(layer0, curLayer, ci, cj, cz);
    for (const [di, dj, cost] of NEIGHBORS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const cardinal = di * dj === 0;
      /** @type {number} */
      let nz;
      if (passable(ni, nj, cz)) {
        nz = cz;
      } else if (world && cardinal && cz + 1 < depth && passable(ni, nj, cz + 1)) {
        nz = cz + 1;
      } else if (world && cardinal && cz > 0 && passable(ni, nj, cz - 1)) {
        nz = cz - 1;
      } else {
        continue;
      }
      if (!cardinal) {
        if (!passable(ci + di, cj, cz) || !passable(ci, cj + dj, cz)) continue;
      }
      const nLayer = nz === cz ? curLayer : layerAt(nz);
      const nEl = totalElevation(layer0, nLayer, ni, nj, nz);
      const dEl = Math.abs(nEl - curFullEl);
      if (dEl >= CLIMB_MAX) continue;
      const hop = dEl > HOP_EPS && dEl < HOP_MAX;
      const climb = dEl >= HOP_MAX;
      if ((hop || climb) && !cardinal) continue;
      let stepCost = cost;
      if (hop) stepCost += HOP_EXTRA_COST;
      else if (climb) stepCost *= CLIMB_COST_MULT;
      // Wading only applies when feet are actually in water — walls over water
      // or upper-layer floors lift the cow above the biome beneath.
      const nIdx = nj * W + ni;
      const aboveWater = nz > 0 || nLayer.wall[nIdx] > 0;
      if (!aboveWater && nLayer.biome[nIdx] === BIOME.SHALLOW_WATER) stepCost *= SHALLOW_WATER_COST;
      relax(flatZ(nz) * layerSize + nj * W + ni, ni, nj, nz, current, stepCost);
    }

    // Vertical moves through ramps. Only meaningful on multi-layer worlds.
    if (world) {
      // Up: a ramp on the current layer lifts us to (ci,cj,cz+1).
      if (cz + 1 < depth && curLayer.isRamp(ci, cj) && passable(ci, cj, cz + 1)) {
        relax((cz + 1) * layerSize + cj * W + ci, ci, cj, cz + 1, current, 1);
      }
      // Down: a ramp on the layer below drops us to (ci,cj,cz-1).
      if (cz > 0 && layerAt(cz - 1).isRamp(ci, cj) && passable(ci, cj, cz - 1)) {
        relax((cz - 1) * layerSize + cj * W + ci, ci, cj, cz - 1, current, 1);
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
   * @param {TileGrid | TileWorld} gridOrWorld
   * @param {(grid: TileGrid, i: number, j: number) => boolean} [walkable]
   * @param {{ capacity?: number }} [opts]
   */
  constructor(gridOrWorld, walkable = defaultWalkable, opts = {}) {
    this.grid = gridOrWorld;
    /** Ground layer — used for W/H in the 2D tile index math. */
    this.layer0 = /** @type {TileGrid} */ (
      Array.isArray(/** @type {any} */ (gridOrWorld).layers)
        ? /** @type {TileWorld} */ (gridOrWorld).layers[0]
        : gridOrWorld
    );
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
   * @param {number} i @param {number} j @param {number} [_z]  accepted for
   *   symmetry with multi-layer callers; the tile index is z-agnostic so we
   *   evict any cached path crossing (i,j) on any layer. Over-eviction is
   *   cheap; under-eviction (stale paths through now-solid tiles) is not.
   */
  invalidateTile(i, j, _z = 0) {
    const W = this.layer0.W;
    const H = this.layer0.H;
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
    const W = this.layer0.W;
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
    const W = this.layer0.W;
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
