import { describe, expect, it } from 'vitest';
import { STAIR_LENGTH, stairFootprintTiles, stairRampTiles, stairTopLandingTile } from '../../src/world/stair.js';

describe('stairFootprintTiles', () => {
  it('spans 5 tiles in facing order from bottom landing to top landing', () => {
    const tiles = stairFootprintTiles({ i: 10, j: 5 }, 0);
    expect(tiles).toHaveLength(STAIR_LENGTH);
    expect(tiles[0]).toEqual({ i: 10, j: 5 });
    expect(tiles[4]).toEqual({ i: 10, j: 9 });
  });

  it('honors all four facings', () => {
    const anchor = { i: 10, j: 10 };
    expect(stairFootprintTiles(anchor, 0)[4]).toEqual({ i: 10, j: 14 });
    expect(stairFootprintTiles(anchor, 1)[4]).toEqual({ i: 14, j: 10 });
    expect(stairFootprintTiles(anchor, 2)[4]).toEqual({ i: 10, j: 6 });
    expect(stairFootprintTiles(anchor, 3)[4]).toEqual({ i: 6, j: 10 });
  });
});

describe('stairRampTiles', () => {
  it('returns the 3 middle tiles (excluding both landings)', () => {
    const ramps = stairRampTiles({ i: 0, j: 0 }, 1);
    expect(ramps).toHaveLength(3);
    expect(ramps[0]).toEqual({ i: 1, j: 0 });
    expect(ramps[1]).toEqual({ i: 2, j: 0 });
    expect(ramps[2]).toEqual({ i: 3, j: 0 });
  });
});

describe('stairTopLandingTile', () => {
  it('is the 5th tile in facing order', () => {
    expect(stairTopLandingTile({ i: 0, j: 0 }, 0)).toEqual({ i: 0, j: 4 });
    expect(stairTopLandingTile({ i: 0, j: 0 }, 3)).toEqual({ i: -4, j: 0 });
  });
});
