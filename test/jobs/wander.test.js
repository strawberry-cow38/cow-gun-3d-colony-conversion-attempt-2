import { describe, expect, it } from 'vitest';
import { pickWanderGoal } from '../../src/jobs/wander.js';
import { BIOME, TileGrid } from '../../src/world/tileGrid.js';

/**
 * Tiny seeded RNG so assertions are deterministic — our picker burns through
 * random() fast and real randomness would flake.
 */
function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return (s & 0x7fffffff) / 0x7fffffff;
  };
}

function allWalkable() {
  return true;
}

describe('pickWanderGoal', () => {
  it('anchors to map center when no structures exist', () => {
    // 60×60 all-grass: no structures → center is (30,30), and any goal must
    // land in the 20-Chebyshev square around it: rows/cols 10..50.
    const grid = new TileGrid(60, 60);
    const rand = seededRand(1);
    for (let n = 0; n < 200; n++) {
      const goal = pickWanderGoal(grid, allWalkable, null, rand);
      expect(goal).not.toBeNull();
      // biome: undefined in allocated buffers is 0 = GRASS, fine.
      expect(goal).toBeDefined();
      if (!goal) continue;
      expect(Math.abs(goal.i - 30)).toBeLessThanOrEqual(20);
      expect(Math.abs(goal.j - 30)).toBeLessThanOrEqual(20);
    }
  });

  it('anchors near a placed structure when one exists', () => {
    // Single wall at (5,5). Every goal must be within 20 Chebyshev of it,
    // which is the only possible anchor.
    const grid = new TileGrid(60, 60);
    grid.setWall(5, 5, 1);
    const rand = seededRand(2);
    for (let n = 0; n < 200; n++) {
      const goal = pickWanderGoal(grid, allWalkable, null, rand);
      expect(goal).not.toBeNull();
      if (!goal) continue;
      expect(Math.abs(goal.i - 5)).toBeLessThanOrEqual(20);
      expect(Math.abs(goal.j - 5)).toBeLessThanOrEqual(20);
    }
  });

  it('never targets water tiles', () => {
    const grid = new TileGrid(10, 10);
    // Flood a 4×4 block with water so a sampler centered at the map center
    // (5,5) will hit these repeatedly unless it filters them out.
    for (let j = 3; j < 7; j++) {
      for (let i = 3; i < 7; i++) {
        grid.biome[grid.idx(i, j)] = BIOME.SHALLOW_WATER;
      }
    }
    // Two water tiles promoted to deep as extra coverage.
    grid.biome[grid.idx(4, 4)] = BIOME.DEEP_WATER;
    grid.biome[grid.idx(5, 5)] = BIOME.DEEP_WATER;
    const rand = seededRand(3);
    for (let n = 0; n < 200; n++) {
      const goal = pickWanderGoal(grid, allWalkable, null, rand);
      if (!goal) continue;
      const b = grid.biome[grid.idx(goal.i, goal.j)];
      expect(b).not.toBe(BIOME.SHALLOW_WATER);
      expect(b).not.toBe(BIOME.DEEP_WATER);
    }
  });

  it('rejects goals on the other side of a river from the cow', () => {
    // Vertical river at i=5 splits a 11-wide map into two land halves. Cow
    // at (2,5) should never receive a goal on the right bank (i>=6).
    const grid = new TileGrid(11, 11);
    for (let j = 0; j < 11; j++) grid.biome[grid.idx(5, j)] = BIOME.SHALLOW_WATER;
    const rand = seededRand(5);
    const from = { i: 2, j: 5 };
    for (let n = 0; n < 200; n++) {
      const goal = pickWanderGoal(grid, allWalkable, from, rand);
      if (!goal) continue;
      expect(goal.i).toBeLessThan(5);
    }
  });

  it('stays inside the map bounds', () => {
    // Corner anchor: structure at (0,0) means samples can stray OOB; picker
    // must skip those and try again.
    const grid = new TileGrid(40, 40);
    grid.setWall(0, 0, 1);
    const rand = seededRand(4);
    for (let n = 0; n < 200; n++) {
      const goal = pickWanderGoal(grid, allWalkable, null, rand);
      if (!goal) continue;
      expect(goal.i).toBeGreaterThanOrEqual(0);
      expect(goal.j).toBeGreaterThanOrEqual(0);
      expect(goal.i).toBeLessThan(grid.W);
      expect(goal.j).toBeLessThan(grid.H);
    }
  });
});
