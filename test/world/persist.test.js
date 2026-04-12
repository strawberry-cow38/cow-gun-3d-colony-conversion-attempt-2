import { describe, expect, it } from 'vitest';
import { hydrateTileGrid, loadState, serializeState } from '../../src/world/persist.js';
import { TileGrid } from '../../src/world/tileGrid.js';

describe('serializeState / hydrateTileGrid roundtrip', () => {
  it('preserves elevation + biome arrays exactly', () => {
    const orig = new TileGrid(8, 6);
    orig.generateSimpleHeightmap(4);
    for (let i = 0; i < orig.W; i++) orig.setBiome(i, 0, i % 4);

    const state = serializeState(orig);
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
    const state = serializeState(tg);
    expect(state.version).toBeGreaterThanOrEqual(1);
  });
});
