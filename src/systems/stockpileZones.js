/**
 * Stockpile zone registry. A zone owns a set of tiles + an allowed-item-kind
 * filter. `grid.stockpile` (the flat Uint8 flag array) stays in sync with
 * zone membership so existing readers (haul.js `isStockpile` checks, overlay)
 * keep working without edits in this phase.
 *
 * Zones are first-class objects: the designator merges overlapping drags into
 * one zone, the selection panel edits the filter, and the haul poster gates
 * deposits on `zoneAt(i,j).allows(kind)`.
 */

import { defaultAllowedKinds } from '../world/items.js';

/**
 * @typedef {Object} Zone
 * @property {number} id                 monotonic, > 0
 * @property {Set<number>} tiles         tile indices (grid.idx)
 * @property {Set<string>} allowedKinds  item kinds the zone accepts
 */

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 */
export function createStockpileZones(grid) {
  const { W, H } = grid;
  /** @type {Map<number, Zone>} */
  const zones = new Map();
  const zoneIdByTile = new Int32Array(W * H);
  let nextId = 1;
  /** @type {(() => void) | null} */
  let onChanged = null;

  function fire() {
    onChanged?.();
  }

  /** @param {(() => void) | null} fn */
  function setOnChanged(fn) {
    onChanged = fn;
  }

  /** @param {number} i @param {number} j */
  function zoneIdAt(i, j) {
    if (!grid.inBounds(i, j)) return 0;
    return zoneIdByTile[grid.idx(i, j)];
  }

  /** @param {number} i @param {number} j */
  function zoneAt(i, j) {
    const id = zoneIdAt(i, j);
    return id > 0 ? (zones.get(id) ?? null) : null;
  }

  /** @param {number} id */
  function zoneById(id) {
    return zones.get(id) ?? null;
  }

  /**
   * Build a fresh zone covering `tileIdxs`. Skips tile indices that already
   * belong to another zone — caller is responsible for merging first if they
   * want those tiles absorbed.
   *
   * @param {Iterable<number>} tileIdxs
   * @param {{ allowedKinds?: Set<string> }} [opts]
   */
  function createZone(tileIdxs, opts) {
    const tiles = new Set();
    for (const idx of tileIdxs) {
      if (zoneIdByTile[idx] !== 0) continue;
      tiles.add(idx);
    }
    if (tiles.size === 0) return null;
    const id = nextId++;
    const zone = {
      id,
      tiles,
      allowedKinds: opts?.allowedKinds ?? defaultAllowedKinds(),
    };
    zones.set(id, zone);
    for (const idx of tiles) {
      zoneIdByTile[idx] = id;
      const i = idx % W;
      const j = (idx - i) / W;
      grid.setStockpile(i, j, 1);
    }
    fire();
    return zone;
  }

  /**
   * Add fresh tiles to an existing zone. Silently skips indices already owned
   * by another zone.
   * @param {number} id @param {Iterable<number>} tileIdxs
   */
  function extendZone(id, tileIdxs) {
    const zone = zones.get(id);
    if (!zone) return false;
    let changed = false;
    for (const idx of tileIdxs) {
      if (zoneIdByTile[idx] !== 0) continue;
      zone.tiles.add(idx);
      zoneIdByTile[idx] = id;
      const i = idx % W;
      const j = (idx - i) / W;
      grid.setStockpile(i, j, 1);
      changed = true;
    }
    if (changed) fire();
    return changed;
  }

  /**
   * Merge every zone in `ids` into one. Surviving zone keeps the lowest id;
   * the others are deleted. Allowed kinds are unioned so a permissive zone
   * doesn't silently inherit stricter rules when it swallows a neighbor.
   * @param {number[]} ids
   */
  function mergeZones(ids) {
    if (ids.length <= 1) return ids[0] ?? 0;
    const uniq = [...new Set(ids.filter((id) => zones.has(id)))];
    if (uniq.length <= 1) return uniq[0] ?? 0;
    uniq.sort((a, b) => a - b);
    const survivor = /** @type {Zone} */ (zones.get(uniq[0]));
    for (let k = 1; k < uniq.length; k++) {
      const victim = /** @type {Zone} */ (zones.get(uniq[k]));
      for (const idx of victim.tiles) {
        survivor.tiles.add(idx);
        zoneIdByTile[idx] = survivor.id;
      }
      for (const kind of victim.allowedKinds) survivor.allowedKinds.add(kind);
      zones.delete(uniq[k]);
    }
    fire();
    return survivor.id;
  }

  /**
   * Remove tiles from whichever zones own them. Any zone that ends up empty
   * is deleted.
   * @param {Iterable<number>} tileIdxs
   */
  function removeTiles(tileIdxs) {
    /** @type {Set<number>} */
    const touched = new Set();
    let changed = false;
    for (const idx of tileIdxs) {
      const id = zoneIdByTile[idx];
      if (id === 0) continue;
      const zone = zones.get(id);
      if (!zone) continue;
      zone.tiles.delete(idx);
      zoneIdByTile[idx] = 0;
      const i = idx % W;
      const j = (idx - i) / W;
      grid.setStockpile(i, j, 0);
      touched.add(id);
      changed = true;
    }
    for (const id of touched) {
      const zone = zones.get(id);
      if (zone && zone.tiles.size === 0) zones.delete(id);
    }
    if (changed) fire();
    return changed;
  }

  /** @param {number} id */
  function deleteZone(id) {
    const zone = zones.get(id);
    if (!zone) return false;
    for (const idx of zone.tiles) {
      zoneIdByTile[idx] = 0;
      const i = idx % W;
      const j = (idx - i) / W;
      grid.setStockpile(i, j, 0);
    }
    zones.delete(id);
    fire();
    return true;
  }

  /**
   * Flip whether `kind` is allowed in `id`'s filter. Returns the new allowed
   * state so the panel can reflect it without re-querying.
   * @param {number} id @param {string} kind @param {boolean} allowed
   */
  function setAllowed(id, kind, allowed) {
    const zone = zones.get(id);
    if (!zone) return null;
    const had = zone.allowedKinds.has(kind);
    if (allowed === had) return allowed;
    if (allowed) zone.allowedKinds.add(kind);
    else zone.allowedKinds.delete(kind);
    fire();
    return allowed;
  }

  /**
   * Check whether the zone at (i,j) accepts `kind`. No zone → false (open
   * tile, not a stockpile at all, so `findAndReserveSlot` shouldn't target it
   * regardless — same as before the zone rework).
   * @param {number} i @param {number} j @param {string} kind
   */
  function allowsAt(i, j, kind) {
    const zone = zoneAt(i, j);
    return zone ? zone.allowedKinds.has(kind) : false;
  }

  /**
   * Hydrate from an existing `grid.stockpile` flag layout (e.g. pre-zone
   * saves). Flood-fills 4-connected runs of stockpile tiles into one zone
   * each, each with the default filter. Clears any in-memory zones first.
   */
  function hydrateFromGrid() {
    zones.clear();
    zoneIdByTile.fill(0);
    nextId = 1;
    const visited = new Uint8Array(W * H);
    const queue = new Int32Array(W * H);
    for (let k0 = 0; k0 < W * H; k0++) {
      if (visited[k0]) continue;
      visited[k0] = 1;
      const i0 = k0 % W;
      const j0 = (k0 - i0) / W;
      if (!grid.isStockpile(i0, j0)) continue;
      let head = 0;
      let tail = 0;
      const tiles = new Set();
      queue[tail++] = k0;
      tiles.add(k0);
      while (head < tail) {
        const k = queue[head++];
        const i = k % W;
        const j = (k - i) / W;
        const nbrs = [
          [i + 1, j],
          [i - 1, j],
          [i, j + 1],
          [i, j - 1],
        ];
        for (const [ni, nj] of nbrs) {
          if (!grid.inBounds(ni, nj)) continue;
          const nk = grid.idx(ni, nj);
          if (visited[nk]) continue;
          visited[nk] = 1;
          if (!grid.isStockpile(ni, nj)) continue;
          tiles.add(nk);
          queue[tail++] = nk;
        }
      }
      const id = nextId++;
      for (const idx of tiles) zoneIdByTile[idx] = id;
      zones.set(id, { id, tiles, allowedKinds: defaultAllowedKinds() });
    }
    fire();
  }

  /**
   * Snapshot → save file. Serializes tiles as grid-index arrays and allowed
   * kinds as string arrays. `nextId` is preserved so re-hydration keeps ids
   * stable across sessions.
   */
  function serialize() {
    return {
      nextId,
      zones: [...zones.values()].map((z) => ({
        id: z.id,
        tiles: [...z.tiles],
        allowedKinds: [...z.allowedKinds],
      })),
    };
  }

  /** @param {{ nextId: number, zones: { id: number, tiles: number[], allowedKinds: string[] }[] }} state */
  function hydrate(state) {
    zones.clear();
    zoneIdByTile.fill(0);
    nextId = state.nextId ?? 1;
    for (const z of state.zones ?? []) {
      const tiles = new Set(z.tiles);
      const allowedKinds = new Set(z.allowedKinds);
      zones.set(z.id, { id: z.id, tiles, allowedKinds });
      for (const idx of tiles) {
        zoneIdByTile[idx] = z.id;
        const i = idx % W;
        const j = (idx - i) / W;
        grid.setStockpile(i, j, 1);
      }
      if (z.id >= nextId) nextId = z.id + 1;
    }
    fire();
  }

  return {
    zones,
    zoneIdByTile,
    zoneIdAt,
    zoneAt,
    zoneById,
    createZone,
    extendZone,
    mergeZones,
    removeTiles,
    deleteZone,
    setAllowed,
    allowsAt,
    hydrateFromGrid,
    serialize,
    hydrate,
    setOnChanged,
  };
}
