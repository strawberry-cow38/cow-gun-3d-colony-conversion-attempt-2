/**
 * Handwritten archetype-style ECS.
 *
 * - Entity = packed 32-bit int (lower 16 bits = slot index, upper 16 = generation).
 * - Component = name + default-value factory.
 * - Archetype = unique sorted set of component names; stores parallel arrays per
 *   component (SoA layout) for cache-friendly iteration.
 * - Query = iterate all archetypes whose set is a superset of the query set.
 *
 * Scope: this module owns entity lifecycle, component registry, archetype storage,
 * and queries. Systems / scheduling / dirty bus live elsewhere.
 */

const SLOT_BITS = 16;
const SLOT_MASK = (1 << SLOT_BITS) - 1;

// Vite replaces `import.meta.env.DEV` with a literal boolean at build time,
// so the DEV guard tree-shakes out of production bundles. Captured in a
// module-level const so tight loops don't hit the env lookup per iteration.
// `import.meta.env` may be undefined outside of vite/vitest runs — fall back
// to false in that case.
const DEV = !!(typeof import.meta !== 'undefined' && import.meta.env?.DEV);

/** @typedef {number} EntityId  packed (slot|gen) */

/**
 * @template T
 * @typedef {{ name: string, factory: () => T }} ComponentDef
 */

export class World {
  constructor() {
    /** @type {Map<string, ComponentDef<any>>} */
    this.components = new Map();
    /** @type {Map<string, Archetype>} */
    this.archetypes = new Map();
    /** Slots: index → { gen, archetype, row } | null. */
    this.slots = [];
    /** Free slot indices for recycling. */
    this.freeSlots = [];
    /** One-shot flag so the rollover warning fires once per session. */
    this.rolloverWarned = false;
  }

  /**
   * Define a component type.
   * @template T
   * @param {string} name
   * @param {() => T} factory  default-value factory; called per entity.
   * @returns {ComponentDef<T>}
   */
  defineComponent(name, factory) {
    if (this.components.has(name)) {
      throw new Error(`component ${name} already defined`);
    }
    const def = { name, factory };
    this.components.set(name, def);
    return def;
  }

  /**
   * Spawn an entity with the given component values.
   * Pass component names as keys; values are merged onto the component's default.
   * @param {Record<string, object>} initial
   * @returns {EntityId}
   */
  spawn(initial = {}) {
    const names = Object.keys(initial).sort();
    for (const name of names) {
      if (!this.components.has(name)) throw new Error(`unknown component ${name}`);
    }
    const archetype = this.#getOrCreateArchetype(names);

    let slotIndex;
    if (this.freeSlots.length > 0) {
      slotIndex = /** @type {number} */ (this.freeSlots.pop());
    } else {
      slotIndex = this.slots.length;
      this.slots.push(null);
    }
    const prev = this.slots[slotIndex];
    const gen = prev ? (prev.gen + 1) & SLOT_MASK : 1;

    const row = archetype.allocRow(slotIndex);
    for (const name of names) {
      const def = /** @type {ComponentDef<any>} */ (this.components.get(name));
      const value = { ...def.factory(), ...initial[name] };
      const col = /** @type {any[]} */ (archetype.columns.get(name));
      col[row] = value;
    }
    this.slots[slotIndex] = { gen, archetype, row };

    return slotIndex | (gen << SLOT_BITS);
  }

  /**
   * Despawn an entity. Safe to call with a stale id (no-op).
   * @param {EntityId} id
   */
  despawn(id) {
    const slot = this.#resolve(id);
    if (!slot) return;
    const { archetype, row } = slot;
    if (!archetype) return;
    const movedSlotIndex = archetype.freeRow(row);
    if (movedSlotIndex !== -1) {
      const moved = this.slots[movedSlotIndex];
      if (moved) moved.row = row;
    }
    const slotIndex = id & SLOT_MASK;
    const gen = (id >>> SLOT_BITS) & SLOT_MASK;
    this.slots[slotIndex] = { gen, archetype: null, row: -1 };
    // gen is 16 bits and bumps on each recycle. If the just-despawned gen was
    // at SLOT_MASK the next reuse would wrap to 0 and start aliasing stale
    // ids that cached a gen=0 entity in some prior life. Retire the slot
    // instead — max leak is SLOT_MASK slots worth of header objects (~1MB),
    // capped by construction.
    if (gen < SLOT_MASK) {
      this.freeSlots.push(slotIndex);
    } else if (!this.rolloverWarned) {
      this.rolloverWarned = true;
      console.warn(
        `[ecs] slot ${slotIndex} retired (generation saturated at ${SLOT_MASK}); future despawns on saturated slots will also retire silently`,
      );
    }
  }

  /**
   * Get a component value for an entity. Returns undefined if missing or stale.
   * @param {EntityId} id
   * @param {string} name
   */
  get(id, name) {
    const slot = this.#resolve(id);
    if (!slot || !slot.archetype) return undefined;
    const col = slot.archetype.columns.get(name);
    return col ? col[slot.row] : undefined;
  }

  /**
   * Query all entities that have ALL of the given components.
   * Yields { id, components: {name: value, ...} } per match.
   *
   * The yielded wrapper AND its components record are reused across rows to
   * avoid per-row GC pressure on hot paths (~10k+ wrappers/tick at colony
   * scale). Callers MUST destructure inline and not retain the wrapper —
   * `[...world.query(...)]` / `Array.from(world.query(...))` / pushing the
   * wrapper into an outer collection will see the last row's state in every
   * slot. Copy the fields you need during iteration.
   *
   * Nested `world.query(...)` calls each spawn their own generator with a
   * distinct wrapper/record, so they don't corrupt each other.
   *
   * DEV-mode enforcement: in dev/test builds we yield a revocable Proxy
   * instead of the raw wrapper, and revoke the previous one before each new
   * yield. Inline-destructure callers read fields while the proxy is live
   * (fine); callers who spread/Array.from the generator end up holding
   * revoked proxies that throw `TypeError: Cannot perform 'get' on a proxy
   * that has been revoked` on any later access — flagging the contract
   * violation loudly. Prod builds yield the wrapper directly.
   *
   * @param {string[]} names
   */
  *query(names) {
    const sorted = [...names].sort();
    // One wrapper + components record per query generator, reused across rows.
    // Callers destructure inside the for-body and don't retain the wrapper, so
    // reuse is safe. Nested queries each spawn their own generator and get
    // their own pair — no cross-contamination.
    /** @type {Record<string, any>} */
    const components = {};
    const wrapper = { id: 0, components };
    /** @type {{ revoke: () => void } | null} */
    let prevRevocable = null;
    for (const archetype of this.archetypes.values()) {
      if (!archetype.has(sorted)) continue;
      const cols = sorted.map((n) => /** @type {any[]} */ (archetype.columns.get(n)));
      for (let row = 0; row < archetype.size; row++) {
        const slotIndex = archetype.rowToSlot[row];
        const slot = this.slots[slotIndex];
        if (!slot) continue;
        for (let i = 0; i < sorted.length; i++) components[sorted[i]] = cols[i][row];
        wrapper.id = slotIndex | (slot.gen << SLOT_BITS);
        if (DEV) {
          if (prevRevocable) prevRevocable.revoke();
          const { proxy, revoke } = Proxy.revocable(wrapper, {});
          prevRevocable = { revoke };
          yield proxy;
        } else {
          yield wrapper;
        }
      }
    }
    if (prevRevocable) prevRevocable.revoke();
  }

  /** Total live entity count. */
  get entityCount() {
    let n = 0;
    for (const a of this.archetypes.values()) n += a.size;
    return n;
  }

  /**
   * @param {EntityId} id
   * @returns {{ gen: number, archetype: Archetype | null, row: number } | null}
   */
  #resolve(id) {
    const slotIndex = id & SLOT_MASK;
    const gen = (id >>> SLOT_BITS) & SLOT_MASK;
    const slot = this.slots[slotIndex];
    if (!slot || slot.gen !== gen || slot.archetype === null) return null;
    return slot;
  }

  /** @param {string[]} sortedNames */
  #getOrCreateArchetype(sortedNames) {
    const key = sortedNames.join('|');
    let a = this.archetypes.get(key);
    if (!a) {
      a = new Archetype(sortedNames);
      this.archetypes.set(key, a);
    }
    return a;
  }
}

/**
 * One archetype = one unique sorted component set.
 * Stores rows of component values in parallel arrays, one per component.
 */
class Archetype {
  /** @param {string[]} sortedNames */
  constructor(sortedNames) {
    this.names = sortedNames;
    this.nameSet = new Set(sortedNames);
    /** @type {Map<string, any[]>} */
    this.columns = new Map();
    for (const n of sortedNames) this.columns.set(n, []);
    /** row index → entity slot index */
    this.rowToSlot = [];
    this.size = 0;
  }

  /** @param {string[]} sortedQueryNames */
  has(sortedQueryNames) {
    for (const n of sortedQueryNames) if (!this.nameSet.has(n)) return false;
    return true;
  }

  /** @param {number} slotIndex */
  allocRow(slotIndex) {
    const row = this.size++;
    this.rowToSlot[row] = slotIndex;
    for (const col of this.columns.values()) col[row] = undefined;
    return row;
  }

  /**
   * Free a row using swap-with-last. Returns the slot index that was moved
   * into this row's spot (or -1 if no swap happened).
   * @param {number} row
   */
  freeRow(row) {
    const last = --this.size;
    if (row === last) {
      for (const col of this.columns.values()) col[last] = undefined;
      this.rowToSlot[last] = -1;
      return -1;
    }
    for (const col of this.columns.values()) {
      col[row] = col[last];
      col[last] = undefined;
    }
    const movedSlot = this.rowToSlot[last];
    this.rowToSlot[row] = movedSlot;
    this.rowToSlot[last] = -1;
    return movedSlot;
  }
}
