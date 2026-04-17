import { describe, expect, it } from 'vitest';
import { PathCache, defaultWalkable, findPath } from '../../src/sim/pathfinding.js';
import { BIOME, TERRAIN_STEP, TileGrid } from '../../src/world/tileGrid.js';
import { TileWorld } from '../../src/world/tileWorld.js';

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

  it('rejects cross-layer paths (start.z !== goal.z)', () => {
    const g = new TileGrid(4, 4);
    const p = findPath(g, { i: 0, j: 0, z: 0 }, { i: 3, j: 3, z: 1 });
    expect(p).toBeNull();
  });

  it('on z > 0, requires floors — air is unwalkable', () => {
    // "Layer 1" represented as a bare TileGrid with no floors. Every tile is
    // air; findPath must refuse any goal here.
    const upper = new TileGrid(4, 4);
    expect(findPath(upper, { i: 0, j: 0, z: 1 }, { i: 3, j: 3, z: 1 })).toBeNull();
  });

  it('on z > 0, routes along floored tiles', () => {
    const upper = new TileGrid(4, 4);
    // Floor the entire row 0, then the full column 3 — L-shaped path only.
    for (let i = 0; i < 4; i++) upper.setFloor(i, 0, 1);
    for (let j = 0; j < 4; j++) upper.setFloor(3, j, 1);
    const p = findPath(upper, { i: 0, j: 0, z: 1 }, { i: 3, j: 3, z: 1 });
    expect(p).not.toBeNull();
    if (p) {
      expect(p[0]).toEqual({ i: 0, j: 0 });
      expect(p[p.length - 1]).toEqual({ i: 3, j: 3 });
      // Every step sits on a floored tile.
      for (const { i, j } of p) expect(upper.isFloor(i, j)).toBe(true);
    }
  });
});

describe('findPath (multi-layer via TileWorld)', () => {
  it('climbs a ramp from z=0 to z=1', () => {
    const world = new TileWorld(new TileGrid(5, 5));
    world.pushEmptyLayer();
    // Ramp at (2,2) bridges z=0 and z=1. Floor a strip on z=1 so the goal has
    // somewhere to walk.
    world.layers[0].setRamp(2, 2, 1);
    for (let i = 2; i < 5; i++) world.layers[1].setFloor(i, 2, 1);
    const p = findPath(world, { i: 0, j: 0, z: 0 }, { i: 4, j: 2, z: 1 });
    expect(p).not.toBeNull();
    if (p) {
      expect(p[0]).toEqual({ i: 0, j: 0, z: 0 });
      expect(p[p.length - 1]).toEqual({ i: 4, j: 2, z: 1 });
      let crossed = false;
      for (let k = 1; k < p.length; k++) {
        if (p[k].z !== p[k - 1].z) {
          expect(p[k].i).toBe(p[k - 1].i);
          expect(p[k].j).toBe(p[k - 1].j);
          expect(p[k].i).toBe(2);
          expect(p[k].j).toBe(2);
          crossed = true;
        }
      }
      expect(crossed).toBe(true);
    }
  });

  it('returns null when no ramp connects the layers', () => {
    const world = new TileWorld(new TileGrid(5, 5));
    world.pushEmptyLayer();
    for (let i = 0; i < 5; i++) world.layers[1].setFloor(i, 2, 1);
    const p = findPath(world, { i: 0, j: 0, z: 0 }, { i: 4, j: 2, z: 1 });
    expect(p).toBeNull();
  });

  it('ramp footprint counts as implicit floor on the upper layer', () => {
    const world = new TileWorld(new TileGrid(4, 4));
    world.pushEmptyLayer();
    // A ramp on the ground — its top tile on z=1 has NO setFloor.
    world.layers[0].setRamp(1, 1, 1);
    const p = findPath(world, { i: 0, j: 0, z: 0 }, { i: 1, j: 1, z: 1 });
    expect(p).not.toBeNull();
    if (p) expect(p[p.length - 1]).toEqual({ i: 1, j: 1, z: 1 });
  });

  it('bounds-checks z against the stack', () => {
    const world = new TileWorld(new TileGrid(3, 3));
    world.pushEmptyLayer();
    expect(findPath(world, { i: 0, j: 0, z: 0 }, { i: 0, j: 0, z: 2 })).toBeNull();
    expect(findPath(world, { i: 0, j: 0, z: -1 }, { i: 0, j: 0, z: 0 })).toBeNull();
  });

  it('single-layer TileWorld still finds flat paths', () => {
    const world = new TileWorld(new TileGrid(5, 5));
    const p = findPath(world, { i: 0, j: 0, z: 0 }, { i: 4, j: 4, z: 0 });
    expect(p).not.toBeNull();
    if (p) {
      expect(p[0]).toEqual({ i: 0, j: 0, z: 0 });
      expect(p[p.length - 1]).toEqual({ i: 4, j: 4, z: 0 });
    }
  });

  it('descends from z=1 back to z=0 through the same ramp', () => {
    const world = new TileWorld(new TileGrid(5, 5));
    world.pushEmptyLayer();
    world.layers[0].setRamp(2, 2, 1);
    for (let i = 2; i < 5; i++) world.layers[1].setFloor(i, 2, 1);
    const p = findPath(world, { i: 4, j: 2, z: 1 }, { i: 0, j: 0, z: 0 });
    expect(p).not.toBeNull();
    if (p) {
      expect(p[0]).toEqual({ i: 4, j: 2, z: 1 });
      expect(p[p.length - 1]).toEqual({ i: 0, j: 0, z: 0 });
    }
  });
});

describe('findPath cliff-climb rules', () => {
  it('allows a 1-step cardinal climb with a small extra cost', () => {
    const g = new TileGrid(4, 4);
    g.setElevation(2, 0, TERRAIN_STEP);
    const p = findPath(g, { i: 0, j: 0 }, { i: 3, j: 0 });
    expect(p).not.toBeNull();
    if (p) {
      expect(p[0]).toEqual({ i: 0, j: 0 });
      expect(p[p.length - 1]).toEqual({ i: 3, j: 0 });
      // Straight-line route preserved — the hop cost is small enough it
      // shouldn't force a detour on a 4-wide board.
      expect(p.length).toBe(4);
    }
  });

  it('rejects a 3-step cliff and routes around it', () => {
    const g = new TileGrid(4, 3);
    // 3-step wall along column 2 — above the climb threshold, so the planner
    // must detour along row 2.
    g.setElevation(2, 0, TERRAIN_STEP * 3);
    g.setElevation(2, 1, TERRAIN_STEP * 3);
    const p = findPath(g, { i: 0, j: 0 }, { i: 3, j: 0 });
    expect(p).not.toBeNull();
    if (p) {
      const straight = p.length === 4 && p.every((s) => s.j === 0);
      expect(straight).toBe(false);
      expect(p[p.length - 1]).toEqual({ i: 3, j: 0 });
    }
  });

  it('returns null when only route requires a >2-step cliff', () => {
    const g = new TileGrid(3, 1);
    g.setElevation(1, 0, TERRAIN_STEP * 3);
    const p = findPath(g, { i: 0, j: 0 }, { i: 2, j: 0 });
    expect(p).toBeNull();
  });

  it('allows a 2-step climb but prefers the detour when available', () => {
    const g = new TileGrid(5, 3);
    // 2-step wall along column 2 — climbable but very expensive (10× cost).
    // A detour via row 2 is only a few extra tiles, so the planner should
    // pick it over wading up the cliff.
    g.setElevation(2, 0, TERRAIN_STEP * 2);
    g.setElevation(2, 1, TERRAIN_STEP * 2);
    const p = findPath(g, { i: 0, j: 0 }, { i: 4, j: 0 });
    expect(p).not.toBeNull();
    if (p) {
      const touchedCliff = p.some((s) => s.i === 2 && s.j < 2);
      expect(touchedCliff).toBe(false);
      expect(p[p.length - 1]).toEqual({ i: 4, j: 0 });
    }
  });

  it('climbs a 2-step cliff when no detour exists', () => {
    // Narrow 1-row corridor: the only path goes over the cliff. Climb must
    // be allowed even though it's expensive.
    const g = new TileGrid(3, 1);
    g.setElevation(1, 0, TERRAIN_STEP * 2);
    const p = findPath(g, { i: 0, j: 0 }, { i: 2, j: 0 });
    expect(p).not.toBeNull();
    if (p) expect(p[1]).toEqual({ i: 1, j: 0 });
  });

  it('prefers dry ground over shallow water when the detour is small', () => {
    // A lake spans the whole middle row between start and goal. A one-tile
    // detour north avoids it — the path must take the detour rather than
    // wading straight through.
    const g = new TileGrid(5, 3);
    for (let i = 1; i < 4; i++) g.setBiome(i, 1, BIOME.SHALLOW_WATER);
    const p = findPath(g, { i: 0, j: 1 }, { i: 4, j: 1 });
    expect(p).not.toBeNull();
    if (p) {
      // Straight wade would keep j=1 for the whole run. Detour steps off row 1.
      const waded = p.every((s) => s.j === 1);
      expect(waded).toBe(false);
    }
  });

  it('still crosses a single shallow-water tile when detour is too long', () => {
    // Single wet tile blocking a narrow corridor. Walking around is much
    // longer than the 5× wet penalty, so the planner wades.
    const g = new TileGrid(3, 1);
    g.setBiome(1, 0, BIOME.SHALLOW_WATER);
    const p = findPath(g, { i: 0, j: 0 }, { i: 2, j: 0 });
    expect(p).not.toBeNull();
    if (p) expect(p[1]).toEqual({ i: 1, j: 0 });
  });

  it('rejects a diagonal hop even at 1 TERRAIN_STEP', () => {
    const g = new TileGrid(3, 3);
    // Make the diagonal neighbor one step higher; block the cardinal-only
    // detour so the only path would be the forbidden diagonal.
    g.setElevation(1, 1, TERRAIN_STEP);
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
