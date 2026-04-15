import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { JobBoard } from '../../src/jobs/board.js';
import { makeFurnaceSystem } from '../../src/systems/furnace.js';
import { TileGrid } from '../../src/world/tileGrid.js';

function makeWorld() {
  const w = new World();
  registerComponents(w);
  return w;
}

function spawnFurnace(world, i, j, workI, workJ, billOverrides = []) {
  return world.spawn({
    Furnace: {
      deconstructJobId: 0,
      progress: 0,
      stuff: 'stone',
      workI,
      workJ,
      workTicksRemaining: 0,
      activeBillId: 0,
    },
    FurnaceViz: {},
    Bills: {
      list: billOverrides.map((b, idx) => ({
        id: idx + 1,
        recipeId: 'smelt_iron',
        suspended: false,
        countMode: 'forever',
        target: 10,
        done: 0,
        ...b,
      })),
      nextBillId: billOverrides.length + 1,
    },
    TileAnchor: { i, j },
    Position: { x: 0, y: 0, z: 0 },
  });
}

function spawnItem(world, i, j, kind, count, opts = {}) {
  return world.spawn({
    Item: { kind, count, capacity: 30, forbidden: false, ...opts },
    ItemViz: {},
    TileAnchor: { i, j },
    Position: { x: 0, y: 0, z: 0 },
  });
}

function tick(world, board, grid) {
  makeFurnaceSystem(board, grid).run(world, /** @type {any} */ ({ tick: 0 }));
}

describe('furnace system: supply posting', () => {
  it('posts supply jobs for each missing ingredient unit when work spot is empty', () => {
    const grid = new TileGrid(8, 8);
    const world = makeWorld();
    spawnFurnace(world, 2, 2, 2, 3, [{}]);
    const coal = spawnItem(world, 5, 5, 'coal', 5);
    const ore = spawnItem(world, 6, 6, 'metal_ore', 20);
    const board = new JobBoard();

    tick(world, board, grid);

    const supply = board.jobs.filter((j) => j.kind === 'supply');
    // Recipe needs 1 coal + 5 metal_ore = 6 supply jobs.
    expect(supply).toHaveLength(6);
    expect(supply.filter((j) => j.payload.kind === 'coal')).toHaveLength(1);
    expect(supply.filter((j) => j.payload.kind === 'metal_ore')).toHaveLength(5);
    for (const j of supply) {
      expect(j.payload.toI).toBe(2);
      expect(j.payload.toJ).toBe(3);
      expect(j.payload.toSupply).toBe(true);
    }
    expect(supply.find((j) => j.payload.kind === 'coal')?.payload.itemId).toBe(coal);
    expect(supply.every((j) => j.payload.kind !== 'metal_ore' || j.payload.itemId === ore)).toBe(
      true,
    );
  });

  it('does not double-post supplies when ones are already in flight', () => {
    const grid = new TileGrid(8, 8);
    const world = makeWorld();
    spawnFurnace(world, 2, 2, 2, 3, [{}]);
    spawnItem(world, 5, 5, 'coal', 5);
    spawnItem(world, 6, 6, 'metal_ore', 20);
    const board = new JobBoard();

    tick(world, board, grid);
    const before = board.jobs.length;
    tick(world, board, grid);
    expect(board.jobs.length).toBe(before);
  });

  it('counts ingredients already on the work spot (forbidden or not)', () => {
    const grid = new TileGrid(8, 8);
    const world = makeWorld();
    const fid = spawnFurnace(world, 2, 2, 2, 3, [{}]);
    spawnItem(world, 2, 3, 'coal', 1, { forbidden: true });
    spawnItem(world, 2, 3, 'metal_ore', 5, { forbidden: true });
    spawnItem(world, 5, 5, 'coal', 10);
    const board = new JobBoard();

    tick(world, board, grid);

    // All ingredients on the spot → craft starts immediately, no supplies.
    expect(board.jobs.filter((j) => j.kind === 'supply')).toHaveLength(0);
    const furnace = world.get(fid, 'Furnace');
    expect(furnace.activeBillId).toBe(1);
    expect(furnace.workTicksRemaining).toBeGreaterThan(0);
  });
});

describe('furnace system: craft lifecycle', () => {
  it('consumes ingredients on craft start and spawns output on completion', () => {
    const grid = new TileGrid(8, 8);
    const world = makeWorld();
    const fid = spawnFurnace(world, 2, 2, 2, 3, [{}]);
    spawnItem(world, 2, 3, 'coal', 1, { forbidden: true });
    spawnItem(world, 2, 3, 'metal_ore', 5, { forbidden: true });
    const board = new JobBoard();

    tick(world, board, grid);
    let furnace = world.get(fid, 'Furnace');
    expect(furnace.activeBillId).toBe(1);
    expect(furnace.workTicksRemaining).toBe(600);

    // Ingredients consumed off the work spot.
    let onSpot = 0;
    for (const { components } of world.query(['Item', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i === 2 && a.j === 3) onSpot += components.Item.count;
    }
    expect(onSpot).toBe(0);

    // Tick forward (rare period = 8). 600/8 = 75 ticks to complete.
    for (let n = 0; n < 75; n++) tick(world, board, grid);
    furnace = world.get(fid, 'Furnace');
    expect(furnace.activeBillId).toBe(0);
    expect(furnace.workTicksRemaining).toBe(0);

    // Output: 5 iron at the work spot.
    let iron = 0;
    for (const { components } of world.query(['Item', 'TileAnchor'])) {
      const a = components.TileAnchor;
      if (a.i === 2 && a.j === 3 && components.Item.kind === 'iron') {
        iron += components.Item.count;
      }
    }
    expect(iron).toBe(5);

    // Bill done counter incremented.
    const bills = world.get(fid, 'Bills');
    expect(bills.list[0].done).toBe(1);
  });

  it('aborts craft when active bill is removed mid-craft', () => {
    const grid = new TileGrid(8, 8);
    const world = makeWorld();
    const fid = spawnFurnace(world, 2, 2, 2, 3, [{}]);
    spawnItem(world, 2, 3, 'coal', 1, { forbidden: true });
    spawnItem(world, 2, 3, 'metal_ore', 5, { forbidden: true });
    const board = new JobBoard();

    tick(world, board, grid);
    expect(world.get(fid, 'Furnace').activeBillId).toBe(1);

    world.get(fid, 'Bills').list = [];
    tick(world, board, grid);
    const furnace = world.get(fid, 'Furnace');
    expect(furnace.activeBillId).toBe(0);
    expect(furnace.workTicksRemaining).toBe(0);
  });

  it('skips suspended bills, falls through to the next eligible one', () => {
    const grid = new TileGrid(8, 8);
    const world = makeWorld();
    const fid = spawnFurnace(world, 2, 2, 2, 3, [{ suspended: true }, { suspended: false }]);
    spawnItem(world, 2, 3, 'coal', 1, { forbidden: true });
    spawnItem(world, 2, 3, 'metal_ore', 5, { forbidden: true });
    const board = new JobBoard();

    tick(world, board, grid);
    expect(world.get(fid, 'Furnace').activeBillId).toBe(2);
  });

  it('skips count-mode bills that are already complete', () => {
    const grid = new TileGrid(8, 8);
    const world = makeWorld();
    spawnFurnace(world, 2, 2, 2, 3, [{ countMode: 'count', target: 3, done: 3 }]);
    spawnItem(world, 5, 5, 'coal', 5);
    spawnItem(world, 6, 6, 'metal_ore', 20);
    const board = new JobBoard();

    tick(world, board, grid);
    expect(board.jobs.filter((j) => j.kind === 'supply')).toHaveLength(0);
  });

  it('skips untilHave bills when world stockpile already meets target', () => {
    const grid = new TileGrid(8, 8);
    const world = makeWorld();
    spawnFurnace(world, 2, 2, 2, 3, [{ countMode: 'untilHave', target: 10 }]);
    spawnItem(world, 5, 5, 'coal', 5);
    spawnItem(world, 6, 6, 'metal_ore', 20);
    spawnItem(world, 7, 7, 'iron', 12);
    const board = new JobBoard();

    tick(world, board, grid);
    expect(board.jobs.filter((j) => j.kind === 'supply')).toHaveLength(0);
  });
});
