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

    // One bundled haul carrying all 3 units of the small stack toward the big one.
    const hauls = board.jobs.filter((j) => j.kind === 'haul');
    expect(hauls).toHaveLength(1);
    expect(hauls[0].payload.itemId).toBe(small);
    expect(hauls[0].payload.count).toBe(3);
    expect(hauls[0].payload.fromI).toBe(0);
    expect(hauls[0].payload.fromJ).toBe(0);
    expect(hauls[0].payload.toI).toBe(3);
    expect(hauls[0].payload.toJ).toBe(3);
    // And the large stack never got drained into the small one.
    expect(board.jobs.some((j) => j.payload.itemId === big)).toBe(false);
  });

  it('respects capacity when merging — bundle size equals destination free room', () => {
    const grid = new TileGrid(4, 4);
    grid.setStockpile(0, 0, 1);
    grid.setStockpile(3, 3, 1);
    const world = makeWorld();
    spawnItem(world, 0, 0, 'wood', 20, 50);
    spawnItem(world, 3, 3, 'wood', 48, 50);
    const board = new JobBoard();

    makeHaulPostingSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));

    const hauls = board.jobs.filter((j) => j.kind === 'haul');
    // dest has room for only 2 more units → one bundled haul with count=2
    expect(hauls).toHaveLength(1);
    expect(hauls[0].payload.count).toBe(2);
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
    expect(hauls).toHaveLength(1);
    expect(hauls[0].payload.count).toBe(5);
    // Lower itemId merges into higher: src should be `a`, dest `b` tile.
    expect(hauls[0].payload.itemId).toBe(a);
    expect(hauls[0].payload.itemId).not.toBe(b);
  });

  it('posts one bundled blueprint-clear haul for a forbidden stack blocking a wall site', () => {
    const grid = new TileGrid(4, 4);
    const world = makeWorld();
    const blocker = spawnItem(world, 1, 1, 'wood', 2, 50, true);
    spawnWallSite(world, 1, 1);
    const board = new JobBoard();

    makeHaulPostingSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));

    const hauls = board.jobs.filter((j) => j.kind === 'haul' && j.payload.itemId === blocker);
    expect(hauls).toHaveLength(1);
    const h = hauls[0];
    expect(h.payload.count).toBe(2);
    expect(h.payload.toRelocation).toBe(true);
    expect(h.payload.fromI).toBe(1);
    expect(h.payload.fromJ).toBe(1);
    expect(h.payload.toI === 1 && h.payload.toJ === 1).toBe(false);
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

  it('posts a `deliver` (tier 2) job when a BuildSite is short on materials — not a plain haul', () => {
    const grid = new TileGrid(4, 4);
    grid.setStockpile(3, 3, 1);
    const world = makeWorld();
    spawnItem(world, 0, 0, 'wood', 1, 50);
    // Site needs 1, has 0 delivered → Pass 0a should post a deliver.
    world.spawn({
      BuildSite: {
        kind: 'wall',
        stuff: 'wood',
        requiredKind: 'wood',
        required: 1,
        delivered: 0,
        buildJobId: 0,
        progress: 0,
      },
      BuildSiteViz: {},
      TileAnchor: { i: 2, j: 2 },
      Position: { x: 0, y: 0, z: 0 },
    });
    const board = new JobBoard();

    makeHaulPostingSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));

    const delivers = board.jobs.filter((j) => j.kind === 'deliver');
    const hauls = board.jobs.filter((j) => j.kind === 'haul');
    expect(delivers).toHaveLength(1);
    expect(delivers[0].tier).toBe(2);
    expect(delivers[0].payload.toBuildSite).toBe(true);
    // The same wood can't be double-claimed for stockpile hauling.
    expect(hauls).toHaveLength(0);
  });

  it('counts cow-carried material toward a BuildSite — does not double-post after pickup', () => {
    const grid = new TileGrid(4, 4);
    grid.setStockpile(0, 0, 1);
    const world = makeWorld();
    // Second stockpile stack so a second deliver job CAN be posted if the
    // in-flight count is wrong.
    spawnItem(world, 0, 0, 'wood', 1, 50);
    spawnItem(world, 3, 3, 'wood', 1, 50);
    world.spawn({
      BuildSite: {
        kind: 'wall',
        stuff: 'wood',
        requiredKind: 'wood',
        required: 1,
        delivered: 0,
        buildJobId: 0,
        progress: 0,
      },
      BuildSiteViz: {},
      TileAnchor: { i: 2, j: 2 },
      Position: { x: 0, y: 0, z: 0 },
    });

    // Simulate a cow mid-delivery: she picked up her wood, so her active Job
    // still points at the site but the board job's payload.count has been
    // zeroed by releaseHaulClaim.
    world.spawn({
      Cow: {},
      Position: { x: 0, y: 0, z: 0 },
      Job: {
        kind: 'deliver',
        payload: { kind: 'wood', count: 0, toI: 2, toJ: 2, toBuildSite: true },
      },
      Inventory: { items: [{ kind: 'wood', count: 1 }] },
    });

    const board = new JobBoard();
    makeHaulPostingSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));

    const delivers = board.jobs.filter(
      (j) => j.kind === 'deliver' && j.payload.toBuildSite === true,
    );
    expect(delivers).toHaveLength(0);
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
