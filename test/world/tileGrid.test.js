import { describe, expect, it } from 'vitest';
import { BIOME, TERRAIN_STEP, TileGrid } from '../../src/world/tileGrid.js';

describe('TileGrid', () => {
  it('constructs with TypedArray storage of correct size', () => {
    const g = new TileGrid(10, 8);
    expect(g.W).toBe(10);
    expect(g.H).toBe(8);
    expect(g.elevation).toBeInstanceOf(Float32Array);
    expect(g.biome).toBeInstanceOf(Uint8Array);
    expect(g.elevation.length).toBe(80);
    expect(g.biome.length).toBe(80);
  });

  it('idx is row-major', () => {
    const g = new TileGrid(10, 8);
    expect(g.idx(0, 0)).toBe(0);
    expect(g.idx(9, 0)).toBe(9);
    expect(g.idx(0, 1)).toBe(10);
    expect(g.idx(3, 4)).toBe(43);
  });

  it('elevation get/set roundtrip', () => {
    const g = new TileGrid(4, 4);
    g.setElevation(2, 3, 5.5);
    expect(g.getElevation(2, 3)).toBe(5.5);
  });

  it('biome get/set roundtrip', () => {
    const g = new TileGrid(4, 4);
    g.setBiome(1, 1, BIOME.STONE);
    expect(g.getBiome(1, 1)).toBe(BIOME.STONE);
  });

  it('inBounds detects edges and corners', () => {
    const g = new TileGrid(4, 4);
    expect(g.inBounds(0, 0)).toBe(true);
    expect(g.inBounds(3, 3)).toBe(true);
    expect(g.inBounds(4, 0)).toBe(false);
    expect(g.inBounds(0, -1)).toBe(false);
  });

  it('generateTerrain paints multiple biomes', () => {
    const g = new TileGrid(32, 32);
    g.generateTerrain();
    /** @type {Set<number>} */
    const seen = new Set();
    for (const v of g.biome) seen.add(v);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('generateTerrain produces stepped elevation on non-water tiles', () => {
    const g = new TileGrid(32, 32);
    g.generateTerrain();
    let nonZero = 0;
    let maxStep = 0;
    for (let k = 0; k < g.elevation.length; k++) {
      const b = g.biome[k];
      if (b === BIOME.DEEP_WATER) continue;
      const e = g.elevation[k];
      expect(e).toBeGreaterThanOrEqual(0);
      // Elevation is always an integer multiple of TERRAIN_STEP. Compare the
      // ratio to a rounded one with a small epsilon so fp noise doesn't trip.
      const ratio = e / TERRAIN_STEP;
      expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-6);
      if (e > 0) nonZero++;
      if (e > maxStep) maxStep = e;
    }
    expect(nonZero).toBeGreaterThan(0);
    expect(maxStep).toBeGreaterThan(0);
  });

  it('generateTerrain sinks deep water, keeps shallow water at Y=0, and steps sand by beach proximity', () => {
    const g = new TileGrid(48, 48);
    g.generateTerrain();
    for (let j = 0; j < g.H; j++) {
      for (let i = 0; i < g.W; i++) {
        const k = g.idx(i, j);
        const b = g.biome[k];
        if (b === BIOME.DEEP_WATER) {
          expect(g.elevation[k]).toBeCloseTo(-TERRAIN_STEP, 3);
        } else if (b === BIOME.SHALLOW_WATER) {
          expect(g.elevation[k]).toBe(0);
        } else if (b === BIOME.SAND) {
          const adjacentToShallow =
            (i > 0 && g.biome[g.idx(i - 1, j)] === BIOME.SHALLOW_WATER) ||
            (i < g.W - 1 && g.biome[g.idx(i + 1, j)] === BIOME.SHALLOW_WATER) ||
            (j > 0 && g.biome[g.idx(i, j - 1)] === BIOME.SHALLOW_WATER) ||
            (j < g.H - 1 && g.biome[g.idx(i, j + 1)] === BIOME.SHALLOW_WATER);
          expect(g.elevation[k]).toBeCloseTo(adjacentToShallow ? 0 : TERRAIN_STEP, 3);
        }
      }
    }
  });
});

describe('TileGrid structureTiles index', () => {
  it('tracks add/remove through the setters', () => {
    const grid = new TileGrid(20, 20);
    expect(grid.structureTiles.size).toBe(0);
    grid.setWall(3, 3, 1);
    grid.setFloor(4, 4, 1);
    grid.setRoof(5, 5, 1);
    grid.setDoor(6, 6, 1);
    grid.setTorch(7, 7, 1);
    expect(grid.structureTiles.size).toBe(5);
    grid.setWall(3, 3, 0);
    expect(grid.structureTiles.size).toBe(4);
    expect(grid.structureTiles.has(grid.idx(3, 3))).toBe(false);
  });

  it('keeps a tile indexed while any structure remains on it', () => {
    const grid = new TileGrid(10, 10);
    const k = grid.idx(2, 2);
    grid.setWall(2, 2, 1);
    grid.setFloor(2, 2, 1);
    expect(grid.structureTiles.has(k)).toBe(true);
    grid.setWall(2, 2, 0);
    expect(grid.structureTiles.has(k)).toBe(true);
    grid.setFloor(2, 2, 0);
    expect(grid.structureTiles.has(k)).toBe(false);
  });

  it('recomputeCounts rebuilds the index from raw bitmaps', () => {
    const grid = new TileGrid(8, 8);
    // Bypass setters so we're exercising the rebuild path that persist/load
    // takes after raw-writing the bitmaps.
    grid.wall[grid.idx(1, 1)] = 1;
    grid.floor[grid.idx(2, 2)] = 1;
    grid.torch[grid.idx(3, 3)] = 1;
    grid.recomputeCounts();
    expect(grid.structureTiles.size).toBe(3);
    expect(grid.structureTiles.has(grid.idx(1, 1))).toBe(true);
    expect(grid.structureTiles.has(grid.idx(2, 2))).toBe(true);
    expect(grid.structureTiles.has(grid.idx(3, 3))).toBe(true);
  });
});

describe('TileGrid ramp bitmap', () => {
  it('ramp get/set roundtrip', () => {
    const g = new TileGrid(4, 4);
    expect(g.isRamp(2, 1)).toBe(false);
    g.setRamp(2, 1, 1);
    expect(g.isRamp(2, 1)).toBe(true);
    g.setRamp(2, 1, 0);
    expect(g.isRamp(2, 1)).toBe(false);
  });

  it('setRamp updates the structureTiles index', () => {
    const g = new TileGrid(6, 6);
    const k = g.idx(3, 2);
    g.setRamp(3, 2, 1);
    expect(g.structureTiles.has(k)).toBe(true);
    g.setRamp(3, 2, 0);
    expect(g.structureTiles.has(k)).toBe(false);
  });

  it('recomputeCounts picks up raw-written ramp bits', () => {
    const g = new TileGrid(5, 5);
    g.ramp[g.idx(1, 2)] = 1;
    g.recomputeCounts();
    expect(g.structureTiles.has(g.idx(1, 2))).toBe(true);
  });
});
