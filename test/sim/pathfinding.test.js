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
    }
  });

  it('uses diagonals when allowed (Chebyshev-optimal length)', () => {
    const g = new TileGrid(10, 10);
    const p = findPath(g, { i: 0, j: 0 }, { i: 5, j: 5 });
    expect(p).not.toBeNull();
    // Chebyshev-optimal: max(|di|, |dj|) + 1 for the start tile. A non-
    // diagonal planner would return > this.
    if (p) expect(p.length).toBeLessThanOrEqual(6);
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

  it('invalidateTile evicts paths that step on the changed tile', () => {
    const g = new TileGrid(8, 8);
    const cache = new PathCache(g, defaultWalkable);
    // (0,0)→(7,0) is a straight east row; passes through (3, 0).
    cache.find({ i: 0, j: 0 }, { i: 7, j: 0 });
    expect(cache.cache.size).toBe(1);
    cache.invalidateTile(3, 0);
    expect(cache.cache.size).toBe(0);
    // Re-querying should miss again.
    cache.find({ i: 0, j: 0 }, { i: 7, j: 0 });
    expect(cache.misses).toBe(2);
  });

  it('invalidateTile leaves unrelated paths intact', () => {
    const g = new TileGrid(10, 10);
    const cache = new PathCache(g, defaultWalkable);
    // (0,0)→(3,0) hugs row 0.
    cache.find({ i: 0, j: 0 }, { i: 3, j: 0 });
    // (0,9)→(3,9) hugs row 9 — nowhere near the change we're about to make.
    cache.find({ i: 0, j: 9 }, { i: 3, j: 9 });
    expect(cache.cache.size).toBe(2);
    cache.invalidateTile(1, 0);
    // First path touched (1, 0) — evicted. Second path didn't — survives.
    expect(cache.cache.size).toBe(1);
    // Hit count confirms the survivor is still hot.
    const hitsBefore = cache.hits;
    cache.find({ i: 0, j: 9 }, { i: 3, j: 9 });
    expect(cache.hits).toBe(hitsBefore + 1);
  });

  it('invalidateTile catches diagonal corner-cut neighbors (3x3)', () => {
    const g = new TileGrid(6, 6);
    const cache = new PathCache(g, defaultWalkable);
    // (0,0)→(5,5) is a pure diagonal; steps are (0,0),(1,1),(2,2),(3,3),(4,4),(5,5).
    // The path never sets foot on (4,3), but the diagonal (3,3)→(4,4) uses
    // (4,3) and (3,4) as corner-cut checks. If (4,3) becomes a wall, the
    // diagonal step must be reconsidered — the 3x3 invalidation catches it.
    cache.find({ i: 0, j: 0 }, { i: 5, j: 5 });
    expect(cache.cache.size).toBe(1);
    cache.invalidateTile(4, 3);
    expect(cache.cache.size).toBe(0);
  });

  it('invalidateTile handles edge/corner tiles without blowing up', () => {
    const g = new TileGrid(4, 4);
    const cache = new PathCache(g, defaultWalkable);
    cache.find({ i: 0, j: 0 }, { i: 3, j: 3 });
    // Corner — 3x3 neighborhood is clipped to the 2x2 at the grid corner.
    expect(() => cache.invalidateTile(0, 0)).not.toThrow();
    expect(cache.cache.size).toBe(0);
  });

  it('invalidateTile evicts null-path entries near endpoints', () => {
    const g = new TileGrid(5, 5);
    // Column 2 is impassable top-to-bottom — no path from (0,0) to (4,4).
    /** @type {(g: TileGrid, i: number, j: number) => boolean} */
    const walkable = (_g, i, _j) => i !== 2;
    const cache = new PathCache(g, walkable);
    const first = cache.find({ i: 0, j: 0 }, { i: 4, j: 4 });
    expect(first).toBeNull();
    expect(cache.cache.size).toBe(1);
    // Invalidating near the start should flush the stale "no route" entry
    // even though the cached value has no path array to scan.
    cache.invalidateTile(0, 0);
    expect(cache.cache.size).toBe(0);
  });

  it('evicted entries do not leak into the tile index', () => {
    const g = new TileGrid(5, 5);
    const cache = new PathCache(g, defaultWalkable);
    cache.find({ i: 0, j: 0 }, { i: 4, j: 4 });
    cache.invalidateTile(2, 2);
    expect(cache.cache.size).toBe(0);
    expect(cache.tileIndex.size).toBe(0);
  });

  it('LRU eviction deindexes the evicted entry', () => {
    const g = new TileGrid(4, 10);
    const cache = new PathCache(g, defaultWalkable, { capacity: 2 });
    // Row 0 path — gets evicted below when capacity overflows.
    cache.find({ i: 0, j: 0 }, { i: 3, j: 0 });
    cache.find({ i: 0, j: 5 }, { i: 3, j: 5 });
    cache.find({ i: 0, j: 9 }, { i: 3, j: 9 });
    expect(cache.cache.size).toBe(2);
    // Invalidating a tile the evicted path used to touch must NOT revive it
    // or corrupt state. Row 0's neighborhood is rows 0-1; rows 5 and 9
    // survive untouched.
    expect(() => cache.invalidateTile(2, 0)).not.toThrow();
    expect(cache.cache.size).toBe(2);
    // Tile index must not still reference the evicted entry under any row-0
    // tile. If deindex leaked, row-0 tiles would still hold a dangling key.
    for (let i = 0; i < 4; i++) {
      const set = cache.tileIndex.get(0 * 4 + i);
      if (set) expect(set.has('0,0,0|3,0,0')).toBe(false);
    }
  });

  it('threads z into cache keys — same (i,j) on a different z misses', () => {
    const g = new TileGrid(4, 4);
    const cache = new PathCache(g, defaultWalkable);
    cache.find({ i: 0, j: 0 }, { i: 3, j: 3 });
    expect(cache.misses).toBe(1);
    // Same (i,j) pair but goal on z=1 must not hit the z=0 cache entry.
    // findPath itself returns null for non-zero z today, so the cache stores
    // a null — but it's stored under a distinct key.
    cache.find({ i: 0, j: 0 }, { i: 3, j: 3, z: 1 });
    expect(cache.misses).toBe(2);
    expect(cache.cache.size).toBe(2);
  });

  it('invalidateTile is a no-op on non-zero z layers', () => {
    const g = new TileGrid(4, 4);
    const cache = new PathCache(g, defaultWalkable);
    cache.find({ i: 0, j: 0 }, { i: 3, j: 3 });
    const sizeBefore = cache.cache.size;
    cache.invalidateTile(2, 2, 1);
    expect(cache.cache.size).toBe(sizeBefore);
  });
});
