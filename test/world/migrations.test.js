import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, runMigrations } from '../../src/world/migrations/index.js';

describe('migration runner', () => {
  it('CURRENT_VERSION is positive', () => {
    expect(CURRENT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('upgrades a v0 save through the chain to CURRENT_VERSION', () => {
    const v0 = { version: 0, W: 2, H: 2, tiles: [1, 2, 3, 4] };
    const out = runMigrations(v0);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.tileGrid).toBeDefined();
    expect(out.tileGrid.W).toBe(2);
    expect(out.tileGrid.elevation).toEqual([1, 2, 3, 4]);
    expect(out.tileGrid.biome).toEqual([0, 0, 0, 0]);
  });

  it('upgrades a v1 save by adding an empty cows array', () => {
    const v1 = { version: 1, tileGrid: { W: 2, H: 1, elevation: [0, 0], biome: [0, 0] } };
    const out = runMigrations(v1);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.cows).toEqual([]);
    expect(out.tileGrid).toEqual(v1.tileGrid);
  });

  it('upgrades a v2 cow by adding default job + path fields', () => {
    const v2 = {
      version: 2,
      tileGrid: { W: 1, H: 1, elevation: [0], biome: [0] },
      cows: [{ name: 'bessie', position: { x: 0, y: 0, z: 0 }, hunger: 0.5 }],
    };
    const out = runMigrations(v2);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.cows[0].job).toEqual({ kind: 'none', state: 'idle', payload: {} });
    expect(out.cows[0].path).toEqual({ steps: [], index: 0 });
  });

  it('passes a CURRENT_VERSION save through unchanged', () => {
    const cur = {
      version: CURRENT_VERSION,
      tileGrid: { W: 1, H: 1, elevation: [0], biome: [0] },
      cows: [],
    };
    const out = runMigrations(cur);
    expect(out).toEqual(cur);
  });

  it('throws if a migration step is missing', () => {
    const orphan = { version: -5 };
    expect(() => runMigrations(orphan)).toThrow(/no migration from version/);
  });
});
