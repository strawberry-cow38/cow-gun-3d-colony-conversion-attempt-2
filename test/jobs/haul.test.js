import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { JobBoard } from '../../src/jobs/board.js';
import { makeHaulPostingSystem } from '../../src/jobs/haul.js';
import { TileGrid } from '../../src/world/tileGrid.js';

function makeWorld() {
  const w = new World();
  registerComponents(w);
  return w;
}

function spawnItem(world, i, j, kind, count, capacity, forbidden = false) {
  return world.spawn({
    Item: { kind, count, capacity, forbidden },
    ItemViz: {},
    TileAnchor: { i, j },
    Position: { x: 0, y: 0, z: 0 },
  });
}

function spawnWallSite(world, i, j) {
  return world.spawn({
    BuildSite: {
      kind: 'wall',
      stuff: 'wood',
      requiredKind: 'wood',
      required: 1,
      delivered: 1,
      buildJobId: 0,
      progress: 0,
    },
    BuildSiteViz: {},
    TileAnchor: { i, j },
    Position: { x: 0, y: 0, z: 0 },
  });
}

describe('haul poster: stack consolidation', () => {
  it('posts hauls from smaller stockpile stack into larger same-kind one, but never both directions', () => {
    const grid = new TileGrid(4, 4);
    grid.setStockpile(0, 0, 1);
    grid.setStockpile(3, 3, 1);
    const world = makeWorld();
    const small = spawnItem(world, 0, 0, 'wood', 3, 50);
    const big = spawnItem(world, 3, 3, 'wood', 10, 50);
    const board = new JobBoard();

    makeHaulPostingSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));

    const hauls = board.jobs.filter((j) => j.kind === 'haul');
    expect(hauls).toHaveLength(3); // drain the small stack toward the big one
    for (const h of hauls) {
      expect(h.payload.itemId).toBe(small);
      expect(h.payload.fromI).toBe(0);
      expect(h.payload.fromJ).toBe(0);
      expect(h.payload.toI).toBe(3);
      expect(h.payload.toJ).toBe(3);
    }
    // And the large stack never got drained into the small one.
    expect(board.jobs.some((j) => j.payload.itemId === big)).toBe(false);
  });

  it('respects capacity when merging — fewer hauls if the destination has little room', () => {
    const grid = new TileGrid(4, 4);
    grid.setStockpile(0, 0, 1);
    grid.setStockpile(3, 3, 1);
    const world = makeWorld();
    spawnItem(world, 0, 0, 'wood', 20, 50);
    spawnItem(world, 3, 3, 'wood', 48, 50);
    const board = new JobBoard();

    makeHaulPostingSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));

    const hauls = board.jobs.filter((j) => j.kind === 'haul');
    // dest has room for only 2 more units
    expect(hauls).toHaveLength(2);
  });

  it('does not consolidate equal-count stacks in a swap — tiebreaker picks one direction', () => {
    const grid = new TileGrid(4, 4);
    grid.setStockpile(0, 0, 1);
    grid.setStockpile(3, 3, 1);
    const world = makeWorld();
    const a = spawnItem(world, 0, 0, 'wood', 5, 50);
    const b = spawnItem(world, 3, 3, 'wood', 5, 50);
    const board = new JobBoard();

    makeHaulPostingSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));

    const hauls = board.jobs.filter((j) => j.kind === 'haul');
    expect(hauls.length).toBe(5); // one direction only
    const fromIds = new Set(hauls.map((h) => h.payload.itemId));
    expect(fromIds.size).toBe(1);
    // Lower itemId merges into higher: src should be `a`, dest `b` tile.
    expect(fromIds.has(a)).toBe(true);
    expect(fromIds.has(b)).toBe(false);
  });

  it('posts blueprint-clear hauls for forbidden stacks blocking wall sites', () => {
    const grid = new TileGrid(4, 4);
    const world = makeWorld();
    const blocker = spawnItem(world, 1, 1, 'wood', 2, 50, true);
    spawnWallSite(world, 1, 1);
    const board = new JobBoard();

    makeHaulPostingSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));

    const hauls = board.jobs.filter((j) => j.kind === 'haul' && j.payload.itemId === blocker);
    expect(hauls.length).toBe(2);
    for (const h of hauls) {
      expect(h.payload.toRelocation).toBe(true);
      expect(h.payload.fromI).toBe(1);
      expect(h.payload.fromJ).toBe(1);
      // relocation target must differ from the wall tile itself
      expect(h.payload.toI === 1 && h.payload.toJ === 1).toBe(false);
    }
    // and drop tiles shouldn't collide with each other within one pass
    const dropKeys = new Set(hauls.map((h) => `${h.payload.toI},${h.payload.toJ}`));
    expect(dropKeys.size).toBe(hauls.length);
  });

  it('leaves forbidden stacks alone when no wall blueprint blocks them', () => {
    const grid = new TileGrid(4, 4);
    grid.setStockpile(3, 3, 1);
    const world = makeWorld();
    spawnItem(world, 1, 1, 'wood', 5, 50, true);
    const board = new JobBoard();

    makeHaulPostingSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));

    expect(board.jobs).toHaveLength(0);
  });

  it('does not merge across different kinds', () => {
    const grid = new TileGrid(4, 4);
    grid.setStockpile(0, 0, 1);
    grid.setStockpile(3, 3, 1);
    const world = makeWorld();
    spawnItem(world, 0, 0, 'wood', 5, 50);
    spawnItem(world, 3, 3, 'stone', 20, 30);
    const board = new JobBoard();

    makeHaulPostingSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));

    expect(board.jobs).toHaveLength(0);
  });
});
