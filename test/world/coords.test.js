import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRID_H,
  DEFAULT_GRID_W,
  TILE_METERS,
  TILE_SIZE,
  UNITS_PER_METER,
  tileToWorld,
  worldToTile,
} from '../../src/world/coords.js';

describe('coordinate constants', () => {
  it('UNITS_PER_METER is 100/3.5 per ARCHITECTURE.md §6', () => {
    expect(UNITS_PER_METER).toBeCloseTo(28.5714, 3);
  });

  it('TILE_METERS is 1.5', () => {
    expect(TILE_METERS).toBe(1.5);
  });

  it('TILE_SIZE is 1.5m × units/m ≈ 42.857 units', () => {
    expect(TILE_SIZE).toBeCloseTo(42.857, 2);
  });

  it('default grid is 200x200', () => {
    expect(DEFAULT_GRID_W).toBe(200);
    expect(DEFAULT_GRID_H).toBe(200);
  });
});

describe('tileToWorld / worldToTile', () => {
  const W = 4;
  const H = 4;

  it('center of grid is near world origin', () => {
    const center = tileToWorld(2, 2, W, H);
    expect(center.x).toBeCloseTo(TILE_SIZE / 2, 5);
    expect(center.z).toBeCloseTo(TILE_SIZE / 2, 5);
  });

  it('worldToTile inverts tileToWorld', () => {
    for (let i = 0; i < W; i++) {
      for (let j = 0; j < H; j++) {
        const w = tileToWorld(i, j, W, H);
        const back = worldToTile(w.x, w.z, W, H);
        expect(back).toEqual({ i, j });
      }
    }
  });

  it('out-of-bounds returns (-1, -1)', () => {
    expect(worldToTile(9999, 9999, W, H)).toEqual({ i: -1, j: -1 });
    expect(worldToTile(-9999, -9999, W, H)).toEqual({ i: -1, j: -1 });
  });
});
