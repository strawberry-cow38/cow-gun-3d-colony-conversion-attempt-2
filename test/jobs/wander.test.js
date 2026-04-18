import { describe, expect, it } from 'vitest';
import { pickWanderGoal } from '../../src/jobs/wander.js';
import { PathCache, defaultWalkable } from '../../src/sim/pathfinding.js';
import { BIOME, TileGrid, WALL_FILL_FULL } from '../../src/world/tileGrid.js';
import { TileWorld } from '../../src/world/tileWorld.js';

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

  it('lets a cow already standing in water pick goals across more water', () => {
    // Same vertical river, but the cow itself is on the river tile (5,5).
    // Already wading → should be allowed to roam to either bank.
    const grid = new TileGrid(11, 11);
    for (let j = 0; j < 11; j++) grid.biome[grid.idx(5, j)] = BIOME.SHALLOW_WATER;
    const rand = seededRand(7);
    const from = { i: 5, j: 5 };
    let pickedRightBank = false;
    for (let n = 0; n < 400; n++) {
      const goal = pickWanderGoal(grid, allWalkable, from, rand);
      if (goal && goal.i > 5) {
        pickedRightBank = true;
        break;
      }
    }
    expect(pickedRightBank).toBe(true);
  });

  it('allows across-river goals when a wall bridge exists', () => {
    // Vertical shallow river at i=5. Stairsteps lead UP to a full wall on
    // (5,5) — wall-top at z=1 is the bridge — and back DOWN on the other
    // side. Pathfinder routes the cow over the bridge without setting feet
    // on a water tile. Each step is 0.75m, well under CLIMB_MAX.
    const world = new TileWorld(new TileGrid(11, 1));
    world.pushEmptyLayer();
    const layer0 = world.layers[0];
    for (let i = 0; i < 11; i++) layer0.biome[layer0.idx(i, 0)] = BIOME.SHALLOW_WATER;
    // Restore land on the banks so the picker has dry ground to target.
    for (let i = 0; i < 5; i++) layer0.biome[layer0.idx(i, 0)] = BIOME.GRASS;
    for (let i = 6; i < 11; i++) layer0.biome[layer0.idx(i, 0)] = BIOME.GRASS;
    layer0.setWallFill(3, 0, 1); // 0.75m
    layer0.setWallFill(4, 0, 2); // 1.5m
    layer0.setWallFill(5, 0, WALL_FILL_FULL); // 3m → wall-top on z=1
    layer0.setWallFill(6, 0, 2);
    layer0.setWallFill(7, 0, 1);
    const paths = new PathCache(world, defaultWalkable);
    const rand = seededRand(9);
    const from = { i: 1, j: 0, z: 0 };
    let pickedRightBank = false;
    for (let n = 0; n < 400; n++) {
      const goal = pickWanderGoal(layer0, defaultWalkable, from, rand, undefined, paths);
      if (goal && goal.i > 5) {
        pickedRightBank = true;
        break;
      }
    }
    expect(pickedRightBank).toBe(true);
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
