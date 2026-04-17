import { describe, expect, it } from 'vitest';
import { TileGrid } from '../../src/world/tileGrid.js';
import { TileWorld } from '../../src/world/tileWorld.js';

describe('TileWorld', () => {
  it('wraps a single TileGrid as layer 0', () => {
    const ground = new TileGrid(4, 4);
    const tw = new TileWorld(ground);
    expect(tw.depth).toBe(1);
    expect(tw.activeZ).toBe(0);
    expect(tw.getLayer(0)).toBe(ground);
    expect(tw.active).toBe(ground);
  });

  it('returns undefined for z outside the stack', () => {
    const tw = new TileWorld(new TileGrid(2, 2));
    expect(tw.getLayer(1)).toBeUndefined();
    expect(tw.getLayer(-1)).toBeUndefined();
  });

  it('pushEmptyLayer grows the stack with a blank same-sized TileGrid', () => {
    const ground = new TileGrid(3, 4);
    const tw = new TileWorld(ground);
    const z = tw.pushEmptyLayer();
    expect(z).toBe(1);
    expect(tw.depth).toBe(2);
    const up = tw.getLayer(1);
    expect(up).toBeDefined();
    expect(up?.W).toBe(3);
    expect(up?.H).toBe(4);
    // Blank layer — no biome set, all zero.
    expect(up?.biome.every((v) => v === 0)).toBe(true);
    // active still tracks z=0.
    expect(tw.active).toBe(ground);
  });
});
