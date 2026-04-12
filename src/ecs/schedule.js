/**
 * System scheduler with tier-based cadences.
 *
 * Tiers (per ARCHITECTURE.md §3):
 * - 'every'  → runs every tick (default)
 * - 'rare'   → runs every 8 ticks
 * - 'long'   → runs every 64 ticks
 * - 'dirty'  → runs only when its watched dirty tag is set; the system is
 *              expected to clear/consume the tag itself.
 *
 * Tick offsets stagger systems within a tier so they don't all run on the
 * same tick (CPU load smoothing).
 */

const TIER_PERIODS = {
  every: 1,
  rare: 8,
  long: 64,
};

/** @typedef {'every'|'rare'|'long'|'dirty'} Tier */

/**
 * @typedef SystemDef
 * @property {string} name
 * @property {Tier} tier
 * @property {(world: import('./world.js').World, ctx: TickCtx) => void} run
 * @property {string} [dirtyTag]   only used when tier === 'dirty'
 * @property {number} [offset]     stagger within tier; defaults to position-in-tier
 */

/**
 * @typedef TickCtx
 * @property {number} dt          fixed sim dt in seconds (1/30 by default)
 * @property {number} tick        absolute tick count since world started
 * @property {DirtyBus} dirty
 */

export class DirtyBus {
  constructor() {
    /** @type {Set<string>} */
    this.set = new Set();
  }
  /** @param {string} tag */
  mark(tag) {
    this.set.add(tag);
  }
  /** @param {string} tag */
  has(tag) {
    return this.set.has(tag);
  }
  /** @param {string} tag */
  consume(tag) {
    return this.set.delete(tag);
  }
  clearAll() {
    this.set.clear();
  }
}

export class Scheduler {
  constructor() {
    /** @type {SystemDef[]} */
    this.systems = [];
    /** Per-system last-run wall-clock-ms (for profiler). */
    this.lastMs = new Map();
    /** Per-system EWMA wall-ms (for profiler). */
    this.avgMs = new Map();
    this.dirty = new DirtyBus();
  }

  /** @param {SystemDef} def */
  add(def) {
    if (!['every', 'rare', 'long', 'dirty'].includes(def.tier)) {
      throw new Error(`bad tier: ${def.tier}`);
    }
    if (def.tier === 'dirty' && !def.dirtyTag) {
      throw new Error(`dirty system ${def.name} needs a dirtyTag`);
    }
    if (def.offset === undefined) {
      const sameTier = this.systems.filter((s) => s.tier === def.tier).length;
      def.offset = sameTier;
    }
    this.systems.push(def);
  }

  /**
   * Run one tick. Determines which systems fire based on tier + tick number.
   * @param {import('./world.js').World} world
   * @param {number} tick
   * @param {number} dt
   */
  tick(world, tick, dt) {
    const ctx = { world, tick, dt, dirty: this.dirty };
    for (const sys of this.systems) {
      if (!this.#shouldRun(sys, tick)) continue;
      const t0 = performance.now();
      sys.run(world, ctx);
      const elapsed = performance.now() - t0;
      this.lastMs.set(sys.name, elapsed);
      const prev = this.avgMs.get(sys.name) ?? elapsed;
      this.avgMs.set(sys.name, prev * 0.9 + elapsed * 0.1);
    }
  }

  /**
   * @param {SystemDef} sys
   * @param {number} tick
   */
  #shouldRun(sys, tick) {
    if (sys.tier === 'dirty') {
      return this.dirty.has(/** @type {string} */ (sys.dirtyTag));
    }
    const period = TIER_PERIODS[sys.tier];
    return (tick + (sys.offset ?? 0)) % period === 0;
  }
}
