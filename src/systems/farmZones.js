/**
 * Farm zone registry. A zone owns a set of tiles + the crop kind to grow.
 * `grid.farmZone` (the flat Uint8 crop-id array) stays in sync with each
 * zone's cropKind so the plant job, overlay, and posting system keep reading
 * it unchanged. Mirrors stockpileZones: designator merges overlapping drags,
 * the panel edits the crop, the selector picks one zone.
 */

import { CROP_ID_FOR_KIND, CROP_KINDS, KIND_FOR_CROP_ID } from '../world/crops.js';

/**
 * @typedef {Object} FarmZone
 * @property {number} id              monotonic, > 0
 * @property {Set<number>} tiles      tile indices (grid.idx)
 * @property {string} cropKind        crop kind (corn|carrot|potato)
 * @property {boolean} allowHarvest   if false, no harvest jobs are posted here
 * @property {boolean} allowTilling   if false, no till/plant jobs are posted here
 * @property {string} [name]          optional user-entered zone name
 */

/**
 * @param {import('../world/tileGrid.js').TileGrid} grid
 */
export function createFarmZones(grid) {
  const { W, H } = grid;
  /** @type {Map<number, FarmZone>} */
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
   * Build a fresh zone covering `tileIdxs` for `cropKind`. Skips tile indices
   * that already belong to another zone.
   *
   * @param {Iterable<number>} tileIdxs
   * @param {{ cropKind?: string }} [opts]
   */
  function createZone(tileIdxs, opts) {
    const cropKind = opts?.cropKind ?? CROP_KINDS[0];
    if (!CROP_ID_FOR_KIND[cropKind]) return null;
    const tiles = new Set();
    for (const idx of tileIdxs) {
      if (zoneIdByTile[idx] !== 0) continue;
      tiles.add(idx);
    }
    if (tiles.size === 0) return null;
    const id = nextId++;
    const zone = { id, tiles, cropKind, allowHarvest: true, allowTilling: true, name: '' };
    zones.set(id, zone);
    const cropId = CROP_ID_FOR_KIND[cropKind];
    for (const idx of tiles) {
      zoneIdByTile[idx] = id;
      const i = idx % W;
      const j = (idx - i) / W;
      grid.setFarmZone(i, j, cropId);
    }
    fire();
    return zone;
  }

  /**
   * @param {number} id @param {Iterable<number>} tileIdxs
   */
  function extendZone(id, tileIdxs) {
    const zone = zones.get(id);
    if (!zone) return false;
    const cropId = CROP_ID_FOR_KIND[zone.cropKind];
    let changed = false;
    for (const idx of tileIdxs) {
      if (zoneIdByTile[idx] !== 0) continue;
      zone.tiles.add(idx);
      zoneIdByTile[idx] = id;
      const i = idx % W;
      const j = (idx - i) / W;
      grid.setFarmZone(i, j, cropId);
      changed = true;
    }
    if (changed) fire();
    return changed;
  }

  /**
   * Merge zones in `ids` into one (lowest id). Surviving zone keeps its own
   * cropKind — union semantics don't make sense for a single-crop-per-zone
   * model. Callers who want a specific crop should setCrop after merging.
   * @param {number[]} ids
   */
  function mergeZones(ids) {
    if (ids.length <= 1) return ids[0] ?? 0;
    const uniq = [...new Set(ids.filter((id) => zones.has(id)))];
    if (uniq.length <= 1) return uniq[0] ?? 0;
    uniq.sort((a, b) => a - b);
    const survivor = /** @type {FarmZone} */ (zones.get(uniq[0]));
    const cropId = CROP_ID_FOR_KIND[survivor.cropKind];
    for (let k = 1; k < uniq.length; k++) {
      const victim = /** @type {FarmZone} */ (zones.get(uniq[k]));
      for (const idx of victim.tiles) {
        survivor.tiles.add(idx);
        zoneIdByTile[idx] = survivor.id;
        const i = idx % W;
        const j = (idx - i) / W;
        grid.setFarmZone(i, j, cropId);
      }
      zones.delete(uniq[k]);
    }
    fire();
    return survivor.id;
  }

  /**
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
      grid.setFarmZone(i, j, 0);
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
      grid.setFarmZone(i, j, 0);
      // Untilling on delete so an abandoned zone doesn't leave bare furrows.
      // Any Crop entity on these tiles keeps its state and just becomes feral
      // until the next poster sweep — the poster reaps orphan jobs on tiles
      // that are no longer zoned, so cows will stop tending it.
      grid.setTilled(i, j, 0);
    }
    zones.delete(id);
    fire();
    return true;
  }

  /** @param {number} id @param {boolean} v */
  function setAllowHarvest(id, v) {
    const zone = zones.get(id);
    if (!zone) return false;
    const next = !!v;
    if (zone.allowHarvest === next) return false;
    zone.allowHarvest = next;
    fire();
    return true;
  }

  /** @param {number} id @param {boolean} v */
  function setAllowTilling(id, v) {
    const zone = zones.get(id);
    if (!zone) return false;
    const next = !!v;
    if (zone.allowTilling === next) return false;
    zone.allowTilling = next;
    fire();
    return true;
  }

  /** @param {number} id @param {string} name */
  function setName(id, name) {
    const zone = zones.get(id);
    if (!zone) return false;
    const next = String(name ?? '').slice(0, 60);
    if (zone.name === next) return false;
    zone.name = next;
    fire();
    return true;
  }

  /**
   * Change a zone's crop. Existing Crop entities on the zone tiles keep their
   * old kind — the farm poster just stops re-seeding there with the old kind
   * and any harvested tiles get replanted with the new one.
   *
   * @param {number} id @param {string} cropKind
   */
  function setCrop(id, cropKind) {
    const zone = zones.get(id);
    if (!zone) return null;
    if (!CROP_ID_FOR_KIND[cropKind]) return null;
    if (zone.cropKind === cropKind) return cropKind;
    zone.cropKind = cropKind;
    const cropId = CROP_ID_FOR_KIND[cropKind];
    for (const idx of zone.tiles) {
      const i = idx % W;
      const j = (idx - i) / W;
      grid.setFarmZone(i, j, cropId);
    }
    fire();
    return cropKind;
  }

  /**
   * Hydrate from an existing `grid.farmZone` crop-id array. Flood-fills
   * 4-connected runs of tiles that share a crop id into one zone each.
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
      const cropId0 = grid.getFarmZone(i0, j0);
      if (cropId0 === 0) continue;
      const kind = KIND_FOR_CROP_ID[cropId0];
      if (!kind) continue;
      let head = 0;
      let tail = 0;
      const tiles = new Set();
      queue[tail++] = k0;
      tiles.add(k0);
      while (head < tail) {
        const k = queue[head++];
        const i = k % W;
        const j = (k - i) / W;
        for (let d = 0; d < 4; d++) {
          const ni = i + (d === 0 ? 1 : d === 1 ? -1 : 0);
          const nj = j + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (!grid.inBounds(ni, nj)) continue;
          const nk = grid.idx(ni, nj);
          if (visited[nk]) continue;
          visited[nk] = 1;
          if (grid.getFarmZone(ni, nj) !== cropId0) continue;
          tiles.add(nk);
          queue[tail++] = nk;
        }
      }
      const id = nextId++;
      for (const idx of tiles) zoneIdByTile[idx] = id;
      zones.set(id, {
        id,
        tiles,
        cropKind: kind,
        allowHarvest: true,
        allowTilling: true,
        name: '',
      });
    }
    fire();
  }

  function serialize() {
    return {
      nextId,
      zones: [...zones.values()].map((z) => ({
        id: z.id,
        tiles: [...z.tiles],
        cropKind: z.cropKind,
        allowHarvest: z.allowHarvest,
        allowTilling: z.allowTilling,
        name: z.name ?? '',
      })),
    };
  }

  /** @param {{ nextId: number, zones: { id: number, tiles: number[], cropKind: string, allowHarvest?: boolean, allowTilling?: boolean, name?: string }[] }} state */
  function hydrate(state) {
    zones.clear();
    zoneIdByTile.fill(0);
    nextId = state.nextId ?? 1;
    for (const z of state.zones ?? []) {
      if (!CROP_ID_FOR_KIND[z.cropKind]) continue;
      const tiles = new Set(z.tiles);
      zones.set(z.id, {
        id: z.id,
        tiles,
        cropKind: z.cropKind,
        allowHarvest: z.allowHarvest ?? true,
        allowTilling: z.allowTilling ?? true,
        name: z.name ?? '',
      });
      const cropId = CROP_ID_FOR_KIND[z.cropKind];
      for (const idx of tiles) {
        zoneIdByTile[idx] = z.id;
        const i = idx % W;
        const j = (idx - i) / W;
        grid.setFarmZone(i, j, cropId);
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
    setCrop,
    setAllowHarvest,
    setAllowTilling,
    setName,
    hydrateFromGrid,
    serialize,
    hydrate,
    setOnChanged,
  };
}

/** @typedef {ReturnType<typeof createFarmZones>} FarmZones */
