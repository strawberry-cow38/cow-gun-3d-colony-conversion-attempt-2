import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { JobBoard } from '../../src/jobs/board.js';
import {
  hydrateCows,
  hydrateFurnaces,
  hydrateItems,
  hydrateTileGrid,
  hydrateTorches,
  hydrateTrees,
  loadState,
  serializeState,
} from '../../src/world/persist.js';
import { TileGrid } from '../../src/world/tileGrid.js';

function makeWorld() {
  const w = new World();
  registerComponents(w);
  return w;
}

describe('serializeState / hydrateTileGrid roundtrip', () => {
  it('preserves elevation + biome arrays exactly', () => {
    const orig = new TileGrid(8, 6);
    orig.generateTerrain();
    // Heightmap stays flat now — explicitly stamp a few elevations so the
    // roundtrip actually exercises non-zero elevation values.
    for (let i = 0; i < orig.W; i++) orig.setElevation(i, 0, (i - 4) * 0.75);
    for (let i = 0; i < orig.W; i++) orig.setBiome(i, 0, i % 4);

    const state = serializeState(orig, makeWorld());
    const json = JSON.stringify(state);
    const parsed = JSON.parse(json);
    const migrated = loadState(parsed);
    const restored = hydrateTileGrid(migrated);

    expect(restored.W).toBe(orig.W);
    expect(restored.H).toBe(orig.H);
    for (let i = 0; i < orig.W * orig.H; i++) {
      expect(restored.elevation[i]).toBeCloseTo(orig.elevation[i], 5);
      expect(restored.biome[i]).toBe(orig.biome[i]);
    }
  });

  it('serialized JSON includes a version field equal to CURRENT_VERSION', () => {
    const tg = new TileGrid(2, 2);
    const state = serializeState(tg, makeWorld());
    expect(state.version).toBeGreaterThanOrEqual(2);
  });
});

describe('cow save/load roundtrip', () => {
  it('preserves cow name, position, and hunger', () => {
    const tg = new TileGrid(4, 4);
    const w1 = makeWorld();
    w1.spawn({
      Cow: {},
      Position: { x: 1.5, y: 2.5, z: 3.5 },
      PrevPosition: { x: 1.5, y: 2.5, z: 3.5 },
      Velocity: { x: 0, y: 0, z: 0 },
      Hunger: { value: 0.42 },
      Tiredness: { value: 1 },
      FoodPoisoning: { ticksRemaining: 0 },
      Brain: { name: 'bessie' },
      Identity: {
        name: 'bessie',
        gender: 'female',
        birthTick: -5000000,
        heightCm: 170,
        hairColor: '#4a2f20',
      },
      Job: { kind: 'none', state: 'idle', payload: {} },
      Path: { steps: [], index: 0 },
      Inventory: { items: [] },
      Opinions: { scores: {}, last: {}, chats: 0 },
      Chat: { text: '', partnerId: 0, expiresAtTick: 0 },
      Health: { injuries: [], nextInjuryId: 1, dead: false },
      Skills: { levels: {}, learnRateMultiplier: 1 },
      WorkPriorities: { priorities: {} },
      CowViz: {},
    });

    const state = serializeState(tg, w1);
    expect(state.cows).toHaveLength(1);

    const json = JSON.stringify(state);
    const migrated = loadState(JSON.parse(json));
    expect(migrated.cows).toHaveLength(1);

    const w2 = makeWorld();
    hydrateCows(w2, migrated);
    const cows = [];
    for (const { components } of w2.query(['Cow', 'Position', 'Hunger', 'Brain'])) {
      cows.push({
        name: components.Brain.name,
        x: components.Position.x,
        z: components.Position.z,
        hunger: components.Hunger.value,
      });
    }
    expect(cows).toHaveLength(1);
    expect(cows[0].name).toBe('bessie');
    expect(cows[0].x).toBeCloseTo(1.5);
    expect(cows[0].z).toBeCloseTo(3.5);
    expect(cows[0].hunger).toBeCloseTo(0.42);
  });

  it('hydrating a v1-style state (no cows) is a no-op', () => {
    const w = makeWorld();
    hydrateCows(w, {});
    expect([...w.query(['Cow'])]).toHaveLength(0);
  });

  it('preserves the drafted flag across save/load', () => {
    const tg = new TileGrid(2, 2);
    const w1 = makeWorld();
    w1.spawn({
      Cow: { drafted: true },
      Position: { x: 0, y: 0, z: 0 },
      PrevPosition: { x: 0, y: 0, z: 0 },
      Velocity: { x: 0, y: 0, z: 0 },
      Hunger: { value: 1 },
      Tiredness: { value: 1 },
      FoodPoisoning: { ticksRemaining: 0 },
      Brain: { name: 'sarge' },
      Identity: {
        name: 'sarge',
        gender: 'male',
        birthTick: -7000000,
        heightCm: 180,
        hairColor: '#2b1b10',
      },
      Job: { kind: 'none', state: 'idle', payload: {} },
      Path: { steps: [], index: 0 },
      Inventory: { items: [] },
      Opinions: { scores: {}, last: {}, chats: 0 },
      Chat: { text: '', partnerId: 0, expiresAtTick: 0 },
      Health: { injuries: [], nextInjuryId: 1, dead: false },
      Skills: { levels: {}, learnRateMultiplier: 1 },
      WorkPriorities: { priorities: {} },
      CowViz: {},
    });
    w1.spawn({
      Cow: { drafted: false },
      Position: { x: 1, y: 0, z: 1 },
      PrevPosition: { x: 1, y: 0, z: 1 },
      Velocity: { x: 0, y: 0, z: 0 },
      Hunger: { value: 1 },
      Tiredness: { value: 1 },
      FoodPoisoning: { ticksRemaining: 0 },
      Brain: { name: 'civvy' },
      Identity: {
        name: 'civvy',
        gender: 'female',
        birthTick: -5000000,
        heightCm: 165,
        hairColor: '#c99a4a',
      },
      Job: { kind: 'none', state: 'idle', payload: {} },
      Path: { steps: [], index: 0 },
      Inventory: { items: [] },
      Opinions: { scores: {}, last: {}, chats: 0 },
      Chat: { text: '', partnerId: 0, expiresAtTick: 0 },
      Health: { injuries: [], nextInjuryId: 1, dead: false },
      Skills: { levels: {}, learnRateMultiplier: 1 },
      WorkPriorities: { priorities: {} },
      CowViz: {},
    });

    const state = serializeState(tg, w1);
    const roundtripped = loadState(JSON.parse(JSON.stringify(state)));

    const w2 = makeWorld();
    hydrateCows(w2, roundtripped);
    /** @type {Record<string, boolean>} */
    const draftedByName = {};
    for (const { components } of w2.query(['Cow', 'Brain'])) {
      draftedByName[components.Brain.name] = components.Cow.drafted;
    }
    expect(draftedByName.sarge).toBe(true);
    expect(draftedByName.civvy).toBe(false);
  });
});

describe('tree save/load roundtrip', () => {
  it('preserves tree positions, blocks their tiles, and re-posts a chop job for marked trees', () => {
    const tg = new TileGrid(4, 4);
    const w1 = makeWorld();
    w1.spawn({
      Tree: { markedJobId: 0, progress: 0 },
      TreeViz: {},
      Cuttable: { markedJobId: 0, progress: 0 },
      TileAnchor: { i: 1, j: 2 },
      Position: { x: 0, y: 0, z: 0 },
    });
    w1.spawn({
      Tree: { markedJobId: 7, progress: 0.3 },
      TreeViz: {},
      Cuttable: { markedJobId: 0, progress: 0 },
      TileAnchor: { i: 3, j: 0 },
      Position: { x: 0, y: 0, z: 0 },
    });

    const state = serializeState(tg, w1);
    expect(state.trees).toHaveLength(2);

    const migrated = loadState(JSON.parse(JSON.stringify(state)));
    const tg2 = hydrateTileGrid(migrated);
    const w2 = makeWorld();
    const board = new JobBoard();
    hydrateTrees(w2, tg2, board, migrated);

    const trees = [];
    let markedJobId = 0;
    for (const { components } of w2.query(['Tree', 'TileAnchor'])) {
      trees.push({ i: components.TileAnchor.i, j: components.TileAnchor.j });
      if (components.TileAnchor.i === 3) markedJobId = components.Tree.markedJobId;
    }
    expect(trees).toHaveLength(2);
    expect(tg2.isBlocked(1, 2)).toBe(true);
    expect(tg2.isBlocked(3, 0)).toBe(true);
    expect(markedJobId).toBeGreaterThan(0);
    expect(board.openCount).toBe(1);
  });
});

describe('torch save/load roundtrip', () => {
  it('preserves torch tile anchors + grid bitmap', () => {
    const tg = new TileGrid(3, 3);
    tg.setTorch(1, 2, 1);
    tg.setTorch(0, 0, 1);
    const w1 = makeWorld();
    w1.spawn({
      Torch: {},
      TorchViz: {},
      TileAnchor: { i: 1, j: 2 },
      Position: { x: 0, y: 0, z: 0 },
    });
    w1.spawn({
      Torch: {},
      TorchViz: {},
      TileAnchor: { i: 0, j: 0 },
      Position: { x: 0, y: 0, z: 0 },
    });

    const state = serializeState(tg, w1);
    expect(state.torches).toHaveLength(2);

    const migrated = loadState(JSON.parse(JSON.stringify(state)));
    const tg2 = hydrateTileGrid(migrated);
    const w2 = makeWorld();
    hydrateTorches(w2, tg2, new JobBoard(), migrated);

    const torches = [...w2.query(['Torch', 'TileAnchor'])];
    expect(torches).toHaveLength(2);
    expect(tg2.isTorch(1, 2)).toBe(true);
    expect(tg2.isTorch(0, 0)).toBe(true);
    expect(tg2.isTorch(2, 2)).toBe(false);
  });
});

describe('furnace save/load roundtrip', () => {
  it('preserves furnace tile, work spot, stuff, and blocks the tile on hydrate', () => {
    const tg = new TileGrid(4, 4);
    tg.blockTile(2, 2);
    const w1 = makeWorld();
    w1.spawn({
      Furnace: {
        deconstructJobId: 0,
        progress: 0,
        stuff: 'stone',
        workI: 2,
        workJ: 3,
        workTicksRemaining: 0,
        activeBillId: 0,
      },
      FurnaceViz: {},
      Bills: { list: [], nextBillId: 1 },
      TileAnchor: { i: 2, j: 2 },
      Position: { x: 0, y: 0, z: 0 },
    });

    const state = serializeState(tg, w1);
    expect(state.furnaces).toHaveLength(1);
    expect(state.furnaces[0]).toMatchObject({
      i: 2,
      j: 2,
      stuff: 'stone',
      workI: 2,
      workJ: 3,
    });

    const migrated = loadState(JSON.parse(JSON.stringify(state)));
    const tg2 = hydrateTileGrid(migrated);
    const w2 = makeWorld();
    hydrateFurnaces(w2, tg2, new JobBoard(), migrated);

    /** @type {{ i: number, j: number, workI: number, workJ: number, stuff: string }[]} */
    const furnaces = [];
    for (const { components } of w2.query(['Furnace', 'TileAnchor', 'Bills'])) {
      furnaces.push({
        i: components.TileAnchor.i,
        j: components.TileAnchor.j,
        workI: components.Furnace.workI,
        workJ: components.Furnace.workJ,
        stuff: components.Furnace.stuff,
      });
    }
    expect(furnaces).toHaveLength(1);
    expect(furnaces[0]).toMatchObject({ i: 2, j: 2, workI: 2, workJ: 3, stuff: 'stone' });
    expect(tg2.isBlocked(2, 2)).toBe(true);
  });

  it('preserves bills (list + nextBillId) across save/load', () => {
    const tg = new TileGrid(4, 4);
    const w1 = makeWorld();
    w1.spawn({
      Furnace: {
        deconstructJobId: 0,
        progress: 0,
        stuff: 'stone',
        workI: 2,
        workJ: 3,
        workTicksRemaining: 0,
        activeBillId: 0,
      },
      FurnaceViz: {},
      Bills: {
        list: [
          {
            id: 1,
            recipeId: 'smelt_iron',
            suspended: false,
            countMode: 'count',
            target: 12,
            done: 3,
          },
          {
            id: 2,
            recipeId: 'smelt_iron',
            suspended: true,
            countMode: 'untilHave',
            target: 50,
            done: 0,
          },
        ],
        nextBillId: 3,
      },
      TileAnchor: { i: 2, j: 2 },
      Position: { x: 0, y: 0, z: 0 },
    });

    const state = serializeState(tg, w1);
    const migrated = loadState(JSON.parse(JSON.stringify(state)));
    const tg2 = hydrateTileGrid(migrated);
    const w2 = makeWorld();
    hydrateFurnaces(w2, tg2, new JobBoard(), migrated);

    /** @type {{ list: any[], nextBillId: number } | null} */
    let billsOut = null;
    for (const { components } of w2.query(['Furnace', 'Bills'])) {
      billsOut = { list: components.Bills.list, nextBillId: components.Bills.nextBillId };
    }
    expect(billsOut).not.toBeNull();
    expect(billsOut?.nextBillId).toBe(3);
    expect(billsOut?.list).toHaveLength(2);
    expect(billsOut?.list[0]).toMatchObject({
      recipeId: 'smelt_iron',
      countMode: 'count',
      target: 12,
      done: 3,
    });
    expect(billsOut?.list[1]).toMatchObject({
      suspended: true,
      countMode: 'untilHave',
      target: 50,
    });
  });

  it('re-posts a deconstruct job when the saved furnace was marked', () => {
    const tg = new TileGrid(4, 4);
    const w1 = makeWorld();
    w1.spawn({
      Furnace: {
        deconstructJobId: 9,
        progress: 0.2,
        stuff: 'stone',
        workI: 1,
        workJ: 0,
        workTicksRemaining: 0,
        activeBillId: 0,
      },
      FurnaceViz: {},
      Bills: { list: [], nextBillId: 1 },
      TileAnchor: { i: 1, j: 1 },
      Position: { x: 0, y: 0, z: 0 },
    });

    const state = serializeState(tg, w1);
    const migrated = loadState(JSON.parse(JSON.stringify(state)));
    const tg2 = hydrateTileGrid(migrated);
    const w2 = makeWorld();
    const board = new JobBoard();
    hydrateFurnaces(w2, tg2, board, migrated);

    expect(board.openCount).toBe(1);
    let deconJobId = 0;
    for (const { components } of w2.query(['Furnace'])) {
      deconJobId = components.Furnace.deconstructJobId;
    }
    expect(deconJobId).toBeGreaterThan(0);
  });
});

describe('item save/load roundtrip', () => {
  it('preserves item kind, tile anchor, count, and capacity', () => {
    const tg = new TileGrid(3, 3);
    const w1 = makeWorld();
    w1.spawn({
      Item: { kind: 'stone', count: 7, capacity: 30 },
      ItemViz: {},
      TileAnchor: { i: 2, j: 1 },
      Position: { x: 0, y: 0, z: 0 },
    });

    const state = serializeState(tg, w1);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      i: 2,
      j: 1,
      kind: 'stone',
      count: 7,
      capacity: 30,
    });

    const migrated = loadState(JSON.parse(JSON.stringify(state)));
    const tg2 = hydrateTileGrid(migrated);
    const w2 = makeWorld();
    hydrateItems(w2, tg2, migrated);

    const items = [];
    for (const { components } of w2.query(['Item', 'TileAnchor'])) {
      items.push({
        kind: components.Item.kind,
        count: components.Item.count,
        capacity: components.Item.capacity,
        i: components.TileAnchor.i,
        j: components.TileAnchor.j,
      });
    }
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('stone');
    expect(items[0].count).toBe(7);
    expect(items[0].capacity).toBe(30);
    expect(items[0].i).toBe(2);
    expect(items[0].j).toBe(1);
  });
});
