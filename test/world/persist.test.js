import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import {
  hydrateCows,
  hydrateTileGrid,
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
});
