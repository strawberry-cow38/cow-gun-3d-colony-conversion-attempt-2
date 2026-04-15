/**
 * Tile grid storage. W × H grid of per-tile data.
 *
 * Per-tile fields:
 * - elevation: number (world units; 0 = ground level)
 * - biome:     small enum uint8 (0=grass, 1=dirt, 2=stone, 3=sand)
 * - occupancy: uint8; nonzero = a world entity (tree, rock, building) blocks the tile.
 *              Transient — NOT serialized; rebuilt from entities on load.
 * - stockpile: uint8; nonzero = player-designated stockpile tile. Serialized.
 * - wall:      uint8; nonzero = finished wall blocks the tile. Serialized.
 *              Separate from occupancy so we can differentiate "wall" vs
 *              "tree" in pathing + hydration without entity lookups.
 * - door:      uint8; nonzero = finished door on the tile. Doors are
 *              WALKABLE — `isBlocked` does not check this — they exist as a
 *              bitmap only so designators can reject double-placement.
 *              Serialized.
 * - torch:     uint8; nonzero = finished torch on the tile. Torches are
 *              decorative, non-blocking, and walkable. Stored as a bitmap so
 *              designators can reject double-placement without scanning
 *              entities. Serialized.
 * - roof:      uint8; nonzero = finished roof on the tile. Roofs don't affect
 *              pathing — they sit above the tile and block sunlight so the
 *              tile under them gets 0% sun. Bitmap so placement checks don't
 *              need entity lookups. Serialized.
 * - ignoreRoof: uint8; nonzero = player designated "don't auto-roof this tile".
 *              Auto-roof skips these. Serialized.
 * - floor:     uint8; nonzero = finished floor on the tile. Floors are
 *              walkable, non-blocking ground-layer tiles. Cows move at 100%
 *              speed on floors and 85% off them (before lighting modifiers).
 *              Serialized.
 * - light:     uint8; 0..255 mapping to 0..100% tile illumination. Derived
 *              from sun% and torches by the lighting system — NOT serialized.
 *              Cows move at half speed on tiles with light below 40%.
 * - farmZone:  uint8; 0 = not a farm tile, 1=corn, 2=carrot, 3=potato. Single
 *              field so zone membership + crop choice share storage; the
 *              non-zero value *is* the desired crop. Serialized.
 * - tilled:    uint8; nonzero = soil has been worked into planting rows.
 *              Independent of farmZone so an un-zoned tilled tile still
 *              renders as soil (e.g. after un-zoning a planted patch).
 *              Serialized.
 * - flower:    uint8; 0 = none, 1..N = flower kind (see world/flowers.js).
 *              Pure decoration — rolled at terrain-gen on a fraction of grass
 *              tiles, rendered as an instanced billboard. Skipped at render
 *              time if the tile has gained a wall/floor/tilled/farmZone since
 *              gen. Serialized.
 */

export const BIOME = Object.freeze({
  GRASS: 0,
  DIRT: 1,
  STONE: 2,
  SAND: 3,
});

export class TileGrid {
  /**
   * @param {number} W
   * @param {number} H
   */
  constructor(W, H) {
    this.W = W;
    this.H = H;
    this.elevation = new Float32Array(W * H);
    this.biome = new Uint8Array(W * H);
    this.occupancy = new Uint8Array(W * H);
    this.stockpile = new Uint8Array(W * H);
    this.wall = new Uint8Array(W * H);
    this.door = new Uint8Array(W * H);
    this.torch = new Uint8Array(W * H);
    this.roof = new Uint8Array(W * H);
    this.ignoreRoof = new Uint8Array(W * H);
    this.floor = new Uint8Array(W * H);
    this.light = new Uint8Array(W * H);
    this.farmZone = new Uint8Array(W * H);
    this.tilled = new Uint8Array(W * H);
    this.flower = new Uint8Array(W * H);
    // Derived counters + torch index — maintained in the setters so lighting
    // can skip its full-grid sweep. Call `recomputeCounts()` after any bulk
    // write that bypasses the setters (e.g. save load).
    this.wallCount = 0;
    this.doorCount = 0;
    this.roofCount = 0;
    this.torchCount = 0;
    /** @type {Set<number>} tile indices with torch=1 */
    this.torchTiles = new Set();
  }

  /** Rebuild derived wall/door/roof counts + torch index from the bitmaps.
   * Call after bulk writes that bypass the setters (save load, terrain init). */
  recomputeCounts() {
    let w = 0;
    let d = 0;
    let r = 0;
    let t = 0;
    this.torchTiles.clear();
    for (let k = 0; k < this.wall.length; k++) {
      if (this.wall[k] !== 0) w++;
      if (this.door[k] !== 0) d++;
      if (this.roof[k] !== 0) r++;
      if (this.torch[k] !== 0) {
        t++;
        this.torchTiles.add(k);
      }
    }
    this.wallCount = w;
    this.doorCount = d;
    this.roofCount = r;
    this.torchCount = t;
  }

  /** @param {number} i @param {number} j */
  isBlocked(i, j) {
    const k = this.idx(i, j);
    return this.occupancy[k] !== 0 || this.wall[k] !== 0;
  }

  /** @param {number} i @param {number} j */
  blockTile(i, j) {
    this.occupancy[this.idx(i, j)] = 1;
  }

  /** @param {number} i @param {number} j */
  unblockTile(i, j) {
    this.occupancy[this.idx(i, j)] = 0;
  }

  /** @param {number} i @param {number} j */
  isStockpile(i, j) {
    return this.stockpile[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setStockpile(i, j, v) {
    this.stockpile[this.idx(i, j)] = v ? 1 : 0;
  }

  /** @param {number} i @param {number} j */
  isWall(i, j) {
    return this.wall[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setWall(i, j, v) {
    const k = this.idx(i, j);
    const was = this.wall[k];
    const now = v ? 1 : 0;
    if (was === now) return;
    this.wall[k] = now;
    this.wallCount += now - was;
  }

  /** @param {number} i @param {number} j */
  isDoor(i, j) {
    return this.door[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setDoor(i, j, v) {
    const k = this.idx(i, j);
    const was = this.door[k];
    const now = v ? 1 : 0;
    if (was === now) return;
    this.door[k] = now;
    this.doorCount += now - was;
  }

  /** @param {number} i @param {number} j */
  isTorch(i, j) {
    return this.torch[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setTorch(i, j, v) {
    const k = this.idx(i, j);
    const was = this.torch[k];
    const now = v ? 1 : 0;
    if (was === now) return;
    this.torch[k] = now;
    if (now) {
      this.torchTiles.add(k);
      this.torchCount++;
    } else {
      this.torchTiles.delete(k);
      this.torchCount--;
    }
  }

  /** @param {number} i @param {number} j */
  isRoof(i, j) {
    return this.roof[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setRoof(i, j, v) {
    const k = this.idx(i, j);
    const was = this.roof[k];
    const now = v ? 1 : 0;
    if (was === now) return;
    this.roof[k] = now;
    this.roofCount += now - was;
  }

  /** @param {number} i @param {number} j */
  isIgnoreRoof(i, j) {
    return this.ignoreRoof[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setIgnoreRoof(i, j, v) {
    this.ignoreRoof[this.idx(i, j)] = v ? 1 : 0;
  }

  /** @param {number} i @param {number} j */
  isFloor(i, j) {
    return this.floor[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setFloor(i, j, v) {
    this.floor[this.idx(i, j)] = v ? 1 : 0;
  }

  /** @param {number} i @param {number} j */
  getFarmZone(i, j) {
    return this.farmZone[this.idx(i, j)];
  }

  /** @param {number} i @param {number} j @param {number} cropId */
  setFarmZone(i, j, cropId) {
    this.farmZone[this.idx(i, j)] = cropId & 0xff;
  }

  /** @param {number} i @param {number} j */
  isTilled(i, j) {
    return this.tilled[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setTilled(i, j, v) {
    this.tilled[this.idx(i, j)] = v ? 1 : 0;
  }

  /** @param {number} i @param {number} j */
  getLight(i, j) {
    return this.light[this.idx(i, j)];
  }

  /** @param {number} i @param {number} j @param {number} v */
  setLight(i, j, v) {
    this.light[this.idx(i, j)] = v;
  }

  /**
   * @param {number} i
   * @param {number} j
   */
  idx(i, j) {
    return j * this.W + i;
  }

  /** @param {number} i @param {number} j */
  inBounds(i, j) {
    return i >= 0 && j >= 0 && i < this.W && j < this.H;
  }

  /** @param {number} i @param {number} j */
  getElevation(i, j) {
    return this.elevation[this.idx(i, j)];
  }

  /** @param {number} i @param {number} j @param {number} v */
  setElevation(i, j, v) {
    this.elevation[this.idx(i, j)] = v;
  }

  /** @param {number} i @param {number} j */
  getBiome(i, j) {
    return this.biome[this.idx(i, j)];
  }

  /** @param {number} i @param {number} j @param {number} v */
  setBiome(i, j, v) {
    this.biome[this.idx(i, j)] = v;
  }

  /**
   * Paint biomes using a low-frequency sin/cos field so stone/sand land in
   * coherent patches instead of salt-and-pepper. Elevation stays at zero —
   * the world is a perfectly flat plane; all the `getElevation` callers still
   * work, they just all get 0. Kept the biome zoning from the old heightmap
   * generator so the map still has visual variety.
   */
  generateTerrain() {
    const bands = 8;
    for (let j = 0; j < this.H; j++) {
      for (let i = 0; i < this.W; i++) {
        const k = this.idx(i, j);
        const fx = i / this.W;
        const fz = j / this.H;
        const n =
          bands * Math.sin(fx * 6.28) * Math.cos(fz * 6.28) +
          bands * 0.4 * Math.sin(fx * 18 + fz * 11);
        if (n > bands * 0.6) this.biome[k] = BIOME.STONE;
        else if (n < -bands * 0.4) this.biome[k] = BIOME.SAND;
        else if (Math.random() < 0.05) this.biome[k] = BIOME.DIRT;
        else {
          this.biome[k] = BIOME.GRASS;
          // Flower kinds 1..5, ~2% of grass. Spatial correlation would look
          // prettier but salt-and-pepper is fine at this density and saves a
          // pass.
          if (Math.random() < 0.02) this.flower[k] = 1 + Math.floor(Math.random() * 5);
        }
      }
    }
  }
}
