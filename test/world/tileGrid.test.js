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
