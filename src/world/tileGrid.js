/**
 * Tile grid storage. W × H grid of per-tile data.
 *
 * Per-tile fields (Phase 2):
 * - elevation: number (in world units; 0 = ground level)
 * - biome:     small enum stored as uint8 (0=grass, 1=dirt, 2=stone, 3=sand)
 *
 * Both backed by TypedArrays for memory + serialization efficiency. A 200×200
 * grid is 40k entries × ~8 bytes = ~320KB total.
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
   * Stamp a deterministic-ish heightmap on the grid using a couple of sin waves.
   * Just for Phase 2 visual variety; will be replaced by real terrain gen later.
   * @param {number} amp
   */
  generateSimpleHeightmap(amp = 8) {
    for (let j = 0; j < this.H; j++) {
      for (let i = 0; i < this.W; i++) {
        const fx = i / this.W;
        const fz = j / this.H;
        const e =
          amp * Math.sin(fx * 6.28) * Math.cos(fz * 6.28) + amp * 0.4 * Math.sin(fx * 18 + fz * 11);
        this.elevation[this.idx(i, j)] = e;
        if (e > amp * 0.6) this.biome[this.idx(i, j)] = BIOME.STONE;
        else if (e < -amp * 0.4) this.biome[this.idx(i, j)] = BIOME.SAND;
        else if (Math.random() < 0.05) this.biome[this.idx(i, j)] = BIOME.DIRT;
        else this.biome[this.idx(i, j)] = BIOME.GRASS;
      }
    }
  }
}
