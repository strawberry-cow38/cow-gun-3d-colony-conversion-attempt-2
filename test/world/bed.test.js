import { describe, expect, it } from 'vitest';
import { BED_SPAN, bedFootprintTiles } from '../../src/world/bed.js';
import { FACING_OFFSETS } from '../../src/world/facing.js';

describe('bed footprint', () => {
  it('spans 2 tiles anchored at the head', () => {
    const tiles = bedFootprintTiles({ i: 5, j: 5 }, 0);
    expect(tiles).toHaveLength(BED_SPAN);
    expect(tiles[0]).toEqual({ i: 5, j: 5 });
  });

  it('extends one tile along the facing direction', () => {
    for (let facing = 0; facing < 4; facing++) {
      const tiles = bedFootprintTiles({ i: 10, j: 10 }, facing);
      const off = FACING_OFFSETS[facing];
      expect(tiles).toEqual([
        { i: 10, j: 10 },
        { i: 10 + off.di, j: 10 + off.dj },
      ]);
    }
  });

  it('produces distinct tiles for any facing', () => {
    for (let facing = 0; facing < 4; facing++) {
      const tiles = bedFootprintTiles({ i: 3, j: 7 }, facing);
      const keys = new Set(tiles.map((t) => `${t.i},${t.j}`));
      expect(keys.size).toBe(BED_SPAN);
    }
  });
});
