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
 * - light:     uint8; 0..255 mapping to 0..100% tile illumination. Derived
 *              from sun% and torches by the lighting system — NOT serialized.
 *              Cows move at half speed on tiles with light below 40%.
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
    this.light = new Uint8Array(W * H);
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
    this.wall[this.idx(i, j)] = v ? 1 : 0;
  }

  /** @param {number} i @param {number} j */
  isDoor(i, j) {
    return this.door[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setDoor(i, j, v) {
    this.door[this.idx(i, j)] = v ? 1 : 0;
  }

  /** @param {number} i @param {number} j */
  isTorch(i, j) {
    return this.torch[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setTorch(i, j, v) {
    this.torch[this.idx(i, j)] = v ? 1 : 0;
  }

  /** @param {number} i @param {number} j */
  isRoof(i, j) {
    return this.roof[this.idx(i, j)] !== 0;
  }

  /** @param {number} i @param {number} j @param {number} v */
  setRoof(i, j, v) {
    this.roof[this.idx(i, j)] = v ? 1 : 0;
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
        const fx = i / this.W;
        const fz = j / this.H;
        const n =
          bands * Math.sin(fx * 6.28) * Math.cos(fz * 6.28) +
          bands * 0.4 * Math.sin(fx * 18 + fz * 11);
        if (n > bands * 0.6) this.biome[this.idx(i, j)] = BIOME.STONE;
        else if (n < -bands * 0.4) this.biome[this.idx(i, j)] = BIOME.SAND;
        else if (Math.random() < 0.05) this.biome[this.idx(i, j)] = BIOME.DIRT;
        else this.biome[this.idx(i, j)] = BIOME.GRASS;
      }
    }
  }
}
