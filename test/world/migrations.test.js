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
    expect(out.tileGrid.W).toBe(v1.tileGrid.W);
    expect(out.tileGrid.H).toBe(v1.tileGrid.H);
    expect(out.tileGrid.elevation).toEqual(v1.tileGrid.elevation);
    expect(out.tileGrid.biome).toEqual(v1.tileGrid.biome);
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

  it('upgrades a v3 save by adding an empty stockpile + empty cow inventory', () => {
    const v3 = {
      version: 3,
      tileGrid: { W: 2, H: 2, elevation: [0, 0, 0, 0], biome: [0, 0, 0, 0] },
      cows: [
        {
          name: 'bessie',
          position: { x: 0, y: 0, z: 0 },
          hunger: 0.8,
          job: { kind: 'none', state: 'idle', payload: {} },
          path: { steps: [], index: 0 },
        },
      ],
    };
    const out = runMigrations(v3);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.tileGrid.stockpile).toEqual([0, 0, 0, 0]);
    expect(out.cows[0].inventory).toEqual({ itemKind: null });
  });

  it('upgrades a v5 save by adding count + capacity to each item', () => {
    const v5 = {
      version: 5,
      tileGrid: {
        W: 2,
        H: 2,
        elevation: [0, 0, 0, 0],
        biome: [0, 0, 0, 0],
        stockpile: [0, 0, 0, 0],
      },
      cows: [],
      trees: [],
      items: [
        { i: 0, j: 0, kind: 'wood' },
        { i: 1, j: 1, kind: 'stone' },
      ],
    };
    const out = runMigrations(v5);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.items[0]).toMatchObject({ i: 0, j: 0, kind: 'wood', count: 1, capacity: 50 });
    expect(out.items[1]).toMatchObject({ i: 1, j: 1, kind: 'stone', count: 1, capacity: 30 });
  });

  it('upgrades a v4 save by adding empty trees + items arrays', () => {
    const v4 = {
      version: 4,
      tileGrid: {
        W: 2,
        H: 2,
        elevation: [0, 0, 0, 0],
        biome: [0, 0, 0, 0],
        stockpile: [0, 0, 0, 0],
      },
      cows: [],
    };
    const out = runMigrations(v4);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.trees).toEqual([]);
    expect(out.items).toEqual([]);
  });

  it('upgrades a v6 save by adding drafted=false to each cow', () => {
    const v6 = {
      version: 6,
      tileGrid: { W: 1, H: 1, elevation: [0], biome: [0], stockpile: [0] },
      cows: [
        {
          name: 'bessie',
          position: { x: 0, y: 0, z: 0 },
          hunger: 0.5,
          job: { kind: 'none', state: 'idle', payload: {} },
          path: { steps: [], index: 0 },
          inventory: { itemKind: null },
        },
      ],
      trees: [],
      items: [],
    };
    const out = runMigrations(v6);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.cows[0].drafted).toBe(false);
    expect(out.cows[0].name).toBe('bessie');
    expect(out.cows[0].inventory).toEqual({ itemKind: null });
  });

  it('upgrades a v7 save by adding empty walls/buildSites + zero wall bitmap', () => {
    const v7 = {
      version: 7,
      tileGrid: { W: 2, H: 1, elevation: [0, 0], biome: [0, 0], stockpile: [0, 0] },
      cows: [],
      trees: [],
      items: [],
    };
    const out = runMigrations(v7);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.tileGrid.wall).toEqual([0, 0]);
    expect(out.buildSites).toEqual([]);
    expect(out.walls).toEqual([]);
  });

  it('passes a CURRENT_VERSION save through unchanged', () => {
    const cur = {
      version: CURRENT_VERSION,
      tileGrid: { W: 1, H: 1, elevation: [0], biome: [0], stockpile: [0] },
      cows: [],
      trees: [],
      items: [{ i: 0, j: 0, kind: 'wood', count: 3, capacity: 50 }],
    };
    const out = runMigrations(cur);
    expect(out).toEqual(cur);
  });

  it('throws if a migration step is missing', () => {
    const orphan = { version: -5 };
    expect(() => runMigrations(orphan)).toThrow(/no migration from version/);
  });
});
