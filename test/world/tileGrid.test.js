import { describe, expect, it } from 'vitest';
import { BIOME, TileGrid } from '../../src/world/tileGrid.js';

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

  it('generateTerrain paints biomes and leaves elevation flat', () => {
    const g = new TileGrid(16, 16);
    g.generateTerrain();
    let nonZero = 0;
    for (const v of g.elevation) if (v !== 0) nonZero++;
    expect(nonZero).toBe(0);
    /** @type {Set<number>} */
    const seen = new Set();
    for (const v of g.biome) seen.add(v);
    expect(seen.size).toBeGreaterThan(1);
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
