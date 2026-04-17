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
});
