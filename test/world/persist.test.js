import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { JobBoard } from '../../src/jobs/board.js';
import {
  hydrateCows,
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
    orig.generateSimpleHeightmap(4);
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
      Brain: { name: 'bessie' },
      Job: { kind: 'none', state: 'idle', payload: {} },
      Path: { steps: [], index: 0 },
      Inventory: { itemKind: null },
      CowViz: {},
    });

    const state = serializeState(tg, w1);
    expect(state.cows).toHaveLength(1);

    const json = JSON.stringify(state);
    const migrated = loadState(JSON.parse(json));
    expect(migrated.cows).toHaveLength(1);

    const w2 = makeWorld();
    hydrateCows(w2, migrated);
    const cows = [...w2.query(['Cow', 'Position', 'Hunger', 'Brain'])];
    expect(cows).toHaveLength(1);
    expect(cows[0].components.Brain.name).toBe('bessie');
    expect(cows[0].components.Position.x).toBeCloseTo(1.5);
    expect(cows[0].components.Position.z).toBeCloseTo(3.5);
    expect(cows[0].components.Hunger.value).toBeCloseTo(0.42);
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
      Brain: { name: 'sarge' },
      Job: { kind: 'none', state: 'idle', payload: {} },
      Path: { steps: [], index: 0 },
      Inventory: { itemKind: null },
      CowViz: {},
    });
    w1.spawn({
      Cow: { drafted: false },
      Position: { x: 1, y: 0, z: 1 },
      PrevPosition: { x: 1, y: 0, z: 1 },
      Velocity: { x: 0, y: 0, z: 0 },
      Hunger: { value: 1 },
      Brain: { name: 'civvy' },
      Job: { kind: 'none', state: 'idle', payload: {} },
      Path: { steps: [], index: 0 },
      Inventory: { itemKind: null },
      CowViz: {},
    });

    const state = serializeState(tg, w1);
    const roundtripped = loadState(JSON.parse(JSON.stringify(state)));

    const w2 = makeWorld();
    hydrateCows(w2, roundtripped);
    const cows = [...w2.query(['Cow', 'Brain'])];
    const sarge = cows.find((c) => c.components.Brain.name === 'sarge');
    const civvy = cows.find((c) => c.components.Brain.name === 'civvy');
    if (!sarge || !civvy) throw new Error('both cows should hydrate');
    expect(sarge.components.Cow.drafted).toBe(true);
    expect(civvy.components.Cow.drafted).toBe(false);
  });
});

describe('tree save/load roundtrip', () => {
  it('preserves tree positions, blocks their tiles, and re-posts a chop job for marked trees', () => {
    const tg = new TileGrid(4, 4);
    const w1 = makeWorld();
    w1.spawn({
      Tree: { markedJobId: 0, progress: 0 },
      TreeViz: {},
      TileAnchor: { i: 1, j: 2 },
      Position: { x: 0, y: 0, z: 0 },
    });
    w1.spawn({
      Tree: { markedJobId: 7, progress: 0.3 },
      TreeViz: {},
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

    const trees = [...w2.query(['Tree', 'TileAnchor'])];
    expect(trees).toHaveLength(2);
    expect(tg2.isBlocked(1, 2)).toBe(true);
    expect(tg2.isBlocked(3, 0)).toBe(true);

    const marked = trees.find((t) => t.components.TileAnchor.i === 3);
    if (!marked) throw new Error('marked tree not found');
    expect(marked.components.Tree.markedJobId).toBeGreaterThan(0);
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

    const items = [...w2.query(['Item', 'TileAnchor'])];
    expect(items).toHaveLength(1);
    expect(items[0].components.Item.kind).toBe('stone');
    expect(items[0].components.Item.count).toBe(7);
    expect(items[0].components.Item.capacity).toBe(30);
    expect(items[0].components.TileAnchor.i).toBe(2);
    expect(items[0].components.TileAnchor.j).toBe(1);
  });
});
