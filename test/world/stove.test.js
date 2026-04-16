import { describe, expect, it } from 'vitest';
import { FACING_SPAN_OFFSETS } from '../../src/world/facing.js';
import { STOVE_SPAN, stoveFootprintTiles } from '../../src/world/stove.js';

describe('stove footprint', () => {
  it('spans 3 tiles with the anchor in the middle', () => {
    const tiles = stoveFootprintTiles({ i: 5, j: 5 }, 0);
    expect(tiles).toHaveLength(STOVE_SPAN);
    const anchors = tiles.filter((t) => t.i === 5 && t.j === 5);
    expect(anchors).toHaveLength(1);
  });

  it('extends along the perpendicular span axis of the facing', () => {
    for (let facing = 0; facing < 4; facing++) {
      const tiles = stoveFootprintTiles({ i: 10, j: 10 }, facing);
      const off = FACING_SPAN_OFFSETS[facing];
      const expected = [
        { i: 10 - off.di, j: 10 - off.dj },
        { i: 10, j: 10 },
        { i: 10 + off.di, j: 10 + off.dj },
      ];
      expect(tiles).toEqual(expected);
    }
  });

  it('produces distinct tiles for any facing', () => {
    for (let facing = 0; facing < 4; facing++) {
      const tiles = stoveFootprintTiles({ i: 3, j: 7 }, facing);
      const keys = new Set(tiles.map((t) => `${t.i},${t.j}`));
      expect(keys.size).toBe(STOVE_SPAN);
    }
  });
});
