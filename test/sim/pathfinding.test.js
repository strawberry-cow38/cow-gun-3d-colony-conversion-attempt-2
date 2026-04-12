import { describe, expect, it } from 'vitest';
import { PathCache, defaultWalkable, findPath } from '../../src/sim/pathfinding.js';
import { TileGrid } from '../../src/world/tileGrid.js';

describe('findPath', () => {
  it('returns single-tile path when start equals goal', () => {
    const g = new TileGrid(4, 4);
    const p = findPath(g, { i: 1, j: 1 }, { i: 1, j: 1 });
    expect(p).toEqual([{ i: 1, j: 1 }]);
  });

  it('returns null for out-of-bounds endpoints', () => {
    const g = new TileGrid(4, 4);
    expect(findPath(g, { i: -1, j: 0 }, { i: 0, j: 0 })).toBeNull();
    expect(findPath(g, { i: 0, j: 0 }, { i: 99, j: 99 })).toBeNull();
  });

  it('finds a straight path on an empty grid', () => {
    const g = new TileGrid(10, 10);
    const p = findPath(g, { i: 0, j: 0 }, { i: 9, j: 0 });
    expect(p).not.toBeNull();
    if (p) {
      expect(p[0]).toEqual({ i: 0, j: 0 });
      expect(p[p.length - 1]).toEqual({ i: 9, j: 0 });
      expect(p.length).toBe(10);
    }
  });

  it('uses diagonals when allowed (Chebyshev-optimal length)', () => {
    const g = new TileGrid(10, 10);
    const p = findPath(g, { i: 0, j: 0 }, { i: 5, j: 5 });
    expect(p).not.toBeNull();
    if (p) expect(p.length).toBe(6); // 5 diagonal steps + start
  });

  it('respects walkability — routes around a wall', () => {
    const g = new TileGrid(7, 7);
    /** @type {(g: TileGrid, i: number, j: number) => boolean} */
    const walkable = (_g, i, j) => !(i === 3 && j !== 6);
    const p = findPath(g, { i: 0, j: 0 }, { i: 6, j: 0 }, walkable);
    expect(p).not.toBeNull();
    if (p) {
      expect(p[0]).toEqual({ i: 0, j: 0 });
      expect(p[p.length - 1]).toEqual({ i: 6, j: 0 });
      for (const step of p) {
        expect(walkable(g, step.i, step.j)).toBe(true);
      }
    }
  });

  it('returns null when no path exists', () => {
    const g = new TileGrid(5, 5);
    /** @type {(g: TileGrid, i: number, j: number) => boolean} */
    const walkable = (_g, i, _j) => i !== 2;
    const p = findPath(g, { i: 0, j: 0 }, { i: 4, j: 4 }, walkable);
    expect(p).toBeNull();
  });

  it('does not corner-cut through diagonal walls', () => {
    const g = new TileGrid(3, 3);
    /** @type {(g: TileGrid, i: number, j: number) => boolean} */
    const walkable = (_g, i, j) => !((i === 1 && j === 0) || (i === 0 && j === 1));
    const p = findPath(g, { i: 0, j: 0 }, { i: 1, j: 1 }, walkable);
    expect(p).toBeNull();
  });
});

describe('PathCache', () => {
  it('memoizes repeated queries', () => {
    const g = new TileGrid(8, 8);
    const cache = new PathCache(g, defaultWalkable);
    const a = cache.find({ i: 0, j: 0 }, { i: 7, j: 7 });
    const b = cache.find({ i: 0, j: 0 }, { i: 7, j: 7 });
    expect(a).toBe(b);
    expect(cache.misses).toBe(1);
    expect(cache.hits).toBe(1);
  });

  it('clear() invalidates cache', () => {
    const g = new TileGrid(4, 4);
    const cache = new PathCache(g, defaultWalkable);
    cache.find({ i: 0, j: 0 }, { i: 3, j: 3 });
    cache.clear();
    cache.find({ i: 0, j: 0 }, { i: 3, j: 3 });
    expect(cache.misses).toBe(2);
  });
});
