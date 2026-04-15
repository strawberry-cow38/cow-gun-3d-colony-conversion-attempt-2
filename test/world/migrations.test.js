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
    expect(out.cows[0].inventory).toEqual({ items: [] });
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
    // v27→v28 rewrites name as "Title firstName Surname", keeping the old
    // token as the first name.
    expect(out.cows[0].identity.firstName).toBe('bessie');
    expect(out.cows[0].name).toContain('bessie');
    expect(out.cows[0].inventory).toEqual({ items: [] });
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

  it('upgrades a v9 save by adding empty torches + zero torch bitmap', () => {
    const v9 = {
      version: 9,
      tileGrid: {
        W: 2,
        H: 1,
        elevation: [0, 0],
        biome: [0, 0],
        stockpile: [0, 0],
        wall: [0, 0],
        door: [0, 0],
      },
      cows: [],
      trees: [],
      items: [],
      buildSites: [],
      walls: [],
      doors: [],
    };
    const out = runMigrations(v9);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.tileGrid.torch).toEqual([0, 0]);
    expect(out.torches).toEqual([]);
  });

  it('upgrades a v10 save by adding decon/progress defaults to walls/doors/torches', () => {
    const v10 = {
      version: 10,
      tileGrid: {
        W: 1,
        H: 1,
        elevation: [0],
        biome: [0],
        stockpile: [0],
        wall: [0],
        door: [0],
        torch: [0],
      },
      cows: [],
      trees: [],
      items: [],
      buildSites: [],
      walls: [{ i: 0, j: 0 }],
      doors: [{ i: 0, j: 0 }],
      torches: [{ i: 0, j: 0 }],
    };
    const out = runMigrations(v10);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.walls[0]).toMatchObject({ i: 0, j: 0, decon: false, progress: 0 });
    expect(out.doors[0]).toMatchObject({ i: 0, j: 0, decon: false, progress: 0 });
    expect(out.torches[0]).toMatchObject({ i: 0, j: 0, decon: false, progress: 0 });
  });

  it('upgrades a v12 save by defaulting stuff=wood on walls/doors/roofs/buildSites', () => {
    const v12 = {
      version: 12,
      tileGrid: {
        W: 1,
        H: 1,
        elevation: [0],
        biome: [0],
        stockpile: [0],
        wall: [0],
        door: [0],
        torch: [0],
        roof: [0],
        ignoreRoof: [0],
      },
      cows: [],
      trees: [],
      items: [],
      buildSites: [
        { i: 0, j: 0, kind: 'wall', requiredKind: 'wood', required: 1, delivered: 0, progress: 0 },
      ],
      walls: [{ i: 0, j: 0, decon: false, progress: 0 }],
      doors: [{ i: 0, j: 0, decon: false, progress: 0 }],
      torches: [{ i: 0, j: 0, decon: false, progress: 0 }],
      roofs: [{ i: 0, j: 0, decon: false, progress: 0 }],
    };
    const out = runMigrations(v12);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.buildSites[0].stuff).toBe('wood');
    expect(out.walls[0].stuff).toBe('wood');
    expect(out.doors[0].stuff).toBe('wood');
    expect(out.roofs[0].stuff).toBe('wood');
  });

  it('upgrades a v11 save by adding roof/ignoreRoof bitmaps + empty roofs array', () => {
    const v11 = {
      version: 11,
      tileGrid: {
        W: 2,
        H: 1,
        elevation: [0, 0],
        biome: [0, 0],
        stockpile: [0, 0],
        wall: [0, 0],
        door: [0, 0],
        torch: [0, 0],
      },
      cows: [],
      trees: [],
      items: [],
      buildSites: [],
      walls: [],
      doors: [],
      torches: [],
    };
    const out = runMigrations(v11);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.tileGrid.roof).toEqual([0, 0]);
    expect(out.tileGrid.ignoreRoof).toEqual([0, 0]);
    expect(out.roofs).toEqual([]);
  });

  it('upgrades a v13 save by adding an empty floor bitmap + empty floors array', () => {
    const v13 = {
      version: 13,
      tileGrid: {
        W: 2,
        H: 1,
        elevation: [0, 0],
        biome: [0, 0],
        stockpile: [0, 0],
        wall: [0, 0],
        door: [0, 0],
        torch: [0, 0],
        roof: [0, 0],
        ignoreRoof: [0, 0],
      },
      cows: [],
      trees: [],
      items: [],
      buildSites: [],
      walls: [],
      doors: [],
      torches: [],
      roofs: [],
    };
    const out = runMigrations(v13);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.tileGrid.floor).toEqual([0, 0]);
    expect(out.floors).toEqual([]);
  });

  it('upgrades a v14 save by adding farmZone + tilled bitmaps + empty crops array', () => {
    const v14 = {
      version: 14,
      tileGrid: {
        W: 2,
        H: 1,
        elevation: [0, 0],
        biome: [0, 0],
        stockpile: [0, 0],
        wall: [0, 0],
        door: [0, 0],
        torch: [0, 0],
        roof: [0, 0],
        ignoreRoof: [0, 0],
        floor: [0, 0],
      },
      cows: [],
      trees: [],
      items: [],
      buildSites: [],
      walls: [],
      doors: [],
      torches: [],
      roofs: [],
      floors: [],
    };
    const out = runMigrations(v14);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.tileGrid.farmZone).toEqual([0, 0]);
    expect(out.tileGrid.tilled).toEqual([0, 0]);
    expect(out.crops).toEqual([]);
  });

  it('preserves a v15 crops array through the v15→v16 bump', () => {
    const v15 = {
      version: 15,
      tileGrid: {
        W: 2,
        H: 1,
        elevation: [0, 0],
        biome: [0, 0],
        stockpile: [0, 0],
        wall: [0, 0],
        door: [0, 0],
        torch: [0, 0],
        roof: [0, 0],
        ignoreRoof: [0, 0],
        floor: [0, 0],
        farmZone: [0, 0],
        tilled: [0, 0],
      },
      cows: [],
      trees: [],
      items: [],
      buildSites: [],
      walls: [],
      doors: [],
      torches: [],
      roofs: [],
      floors: [],
      crops: [{ i: 1, j: 0, kind: 'corn', growthTicks: 42 }],
    };
    const out = runMigrations(v15);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.crops[0]).toMatchObject({ i: 1, j: 0, kind: 'corn', growthTicks: 42 });
  });

  it('adds forbidden: false to every v16 item through the v16→v17 bump', () => {
    const v16 = {
      version: 16,
      tileGrid: {
        W: 1,
        H: 1,
        elevation: [0],
        biome: [0],
        stockpile: [0],
        wall: [0],
        door: [0],
        torch: [0],
        roof: [0],
        ignoreRoof: [0],
        floor: [0],
        farmZone: [0],
        tilled: [0],
      },
      cows: [],
      trees: [],
      items: [
        { i: 0, j: 0, kind: 'wood', count: 5, capacity: 50 },
        { i: 0, j: 0, kind: 'food', count: 2, capacity: 20 },
      ],
      buildSites: [],
      walls: [],
      doors: [],
      torches: [],
      roofs: [],
      floors: [],
      crops: [],
    };
    const out = runMigrations(v16);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.items).toEqual([
      { i: 0, j: 0, kind: 'wood', count: 5, capacity: 50, forbidden: false },
      { i: 0, j: 0, kind: 'food', count: 2, capacity: 20, forbidden: false },
    ]);
  });

  it('defaults every v17 tree to oak at full growth through the v17→v18 bump', () => {
    const v17 = {
      version: 17,
      tileGrid: {
        W: 1,
        H: 1,
        elevation: [0],
        biome: [0],
        stockpile: [0],
        wall: [0],
        door: [0],
        torch: [0],
        roof: [0],
        ignoreRoof: [0],
        floor: [0],
        farmZone: [0],
        tilled: [0],
      },
      cows: [],
      trees: [
        { i: 0, j: 0, marked: false, progress: 0 },
        { i: 1, j: 2, marked: true, progress: 0.4 },
      ],
      items: [],
      buildSites: [],
      walls: [],
      doors: [],
      torches: [],
      roofs: [],
      floors: [],
      crops: [],
    };
    const out = runMigrations(v17);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.trees[0]).toMatchObject({
      i: 0,
      j: 0,
      marked: false,
      progress: 0,
      kind: 'oak',
      growth: 1,
    });
    expect(out.trees[1]).toMatchObject({
      i: 1,
      j: 2,
      marked: true,
      progress: 0.4,
      kind: 'oak',
      growth: 1,
    });
  });

  it('adds an empty boulders list through the v18→v19 bump', () => {
    const v18 = {
      version: 18,
      tileGrid: {
        W: 1,
        H: 1,
        elevation: [0],
        biome: [0],
        stockpile: [0],
        wall: [0],
        door: [0],
        torch: [0],
        roof: [0],
        ignoreRoof: [0],
        floor: [0],
        farmZone: [0],
        tilled: [0],
      },
      cows: [],
      trees: [],
      items: [],
      buildSites: [],
      walls: [],
      doors: [],
      torches: [],
      roofs: [],
      floors: [],
      crops: [],
    };
    const out = runMigrations(v18);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.boulders).toEqual([]);
  });

  it('adds cutMarked + cutProgress to trees and crops through the v19→v20 bump', () => {
    const v19 = {
      version: 19,
      tileGrid: {
        W: 1,
        H: 1,
        elevation: [0],
        biome: [0],
        stockpile: [0],
        wall: [0],
        door: [0],
        torch: [0],
        roof: [0],
        ignoreRoof: [0],
        floor: [0],
        farmZone: [0],
        tilled: [0],
      },
      cows: [],
      trees: [{ i: 0, j: 0, marked: false, progress: 0, kind: 'oak', growth: 0.3 }],
      items: [],
      buildSites: [],
      walls: [],
      doors: [],
      torches: [],
      roofs: [],
      floors: [],
      crops: [{ i: 0, j: 0, kind: 'corn', growthTicks: 12 }],
      boulders: [],
    };
    const out = runMigrations(v19);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.trees[0]).toMatchObject({ cutMarked: false, cutProgress: 0, growth: 0.3 });
    expect(out.crops[0]).toMatchObject({ cutMarked: false, cutProgress: 0, growthTicks: 12 });
  });

  it('adds an empty furnaces array through the v20→v21 bump', () => {
    const v20 = {
      version: 20,
      tileGrid: {
        W: 1,
        H: 1,
        elevation: [0],
        biome: [0],
        stockpile: [0],
        wall: [0],
        door: [0],
        torch: [0],
        roof: [0],
        ignoreRoof: [0],
        floor: [0],
        farmZone: [0],
        tilled: [0],
      },
      cows: [],
      trees: [],
      items: [],
      buildSites: [],
      walls: [],
      doors: [],
      torches: [],
      roofs: [],
      floors: [],
      crops: [],
      boulders: [],
    };
    const out = runMigrations(v20);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(out.furnaces).toEqual([]);
  });

  it('rolls childhood + profession onto existing cows in the v30→v31 bump', () => {
    const v30 = {
      version: 30,
      tileGrid: { W: 1, H: 1, elevation: [0], biome: [0], stockpile: [0] },
      cows: [
        {
          name: 'Dr. Bessie Moonfield',
          drafted: false,
          position: { x: 0, y: 0, z: 0 },
          hunger: 1,
          job: { kind: 'none', state: 'idle', payload: {} },
          path: { steps: [], index: 0 },
          inventory: { items: [] },
          identity: {
            gender: 'female',
            birthTick: -1000000,
            heightCm: 170,
            hairColor: '#4a2f20',
            traits: [],
            firstName: 'Bessie',
            surname: 'Moonfield',
            title: 'Dr.',
          },
          opinions: { scores: {}, last: {}, chats: 0 },
        },
      ],
      trees: [],
      items: [],
    };
    const out = runMigrations(v30);
    expect(out.version).toBe(CURRENT_VERSION);
    expect(typeof out.cows[0].identity.childhood).toBe('string');
    expect(out.cows[0].identity.childhood.length).toBeGreaterThan(0);
    expect(typeof out.cows[0].identity.profession).toBe('string');
    expect(out.cows[0].identity.profession.length).toBeGreaterThan(0);
  });

  it('carves water lakes out of interior sand in the v31→v32 bump', () => {
    // 7×7 grid: dirt border, 5×5 sand interior. Only tile (3,3) has a full
    // 5×5 all-sand Chebyshev neighborhood, so it alone flips to water — the
    // ring of sand at distance 1 stays sand (acts as the shore).
    const W = 7;
    const H = 7;
    const biome = new Array(W * H).fill(1); // BIOME.DIRT border
    for (let j = 1; j < H - 1; j++) {
      for (let i = 1; i < W - 1; i++) biome[j * W + i] = 3; // BIOME.SAND
    }
    const v31 = {
      version: 31,
      tileGrid: {
        W,
        H,
        elevation: new Array(W * H).fill(0),
        biome,
        stockpile: new Array(W * H).fill(0),
      },
      cows: [],
      trees: [],
      items: [],
    };
    const out = runMigrations(v31);
    expect(out.version).toBe(CURRENT_VERSION);
    const b = out.tileGrid.biome;
    expect(b[3 * W + 3]).toBe(4); // BIOME.SHALLOW_WATER at center
    expect(b[1 * W + 1]).toBe(3); // shore sand stays sand
    expect(b[2 * W + 2]).toBe(3); // inner sand without 5x5 sand neighborhood stays sand
    expect(b[0]).toBe(1); // dirt border untouched
  });

  it('promotes interior shallow water to deep in the v32→v33 bump', () => {
    // 19×19 grid: single-tile dirt border, 17×17 sand interior. Shore erosion
    // (5×5) turns tiles (3..15, 3..15) into shallow water; deep erosion
    // (13×13) then picks out exactly the center tile (9,9), whose window
    // [3..15] × [3..15] is fully inside the shallow region. A 6-tile-wide
    // shallow ring survives between shore and deep — the wade zone.
    const W = 19;
    const H = 19;
    const biome = new Array(W * H).fill(1); // BIOME.DIRT border
    for (let j = 1; j < H - 1; j++) {
      for (let i = 1; i < W - 1; i++) biome[j * W + i] = 3; // BIOME.SAND
    }
    const v31 = {
      version: 31,
      tileGrid: {
        W,
        H,
        elevation: new Array(W * H).fill(0),
        biome,
        stockpile: new Array(W * H).fill(0),
      },
      cows: [],
      trees: [],
      items: [],
    };
    const out = runMigrations(v31);
    expect(out.version).toBe(CURRENT_VERSION);
    const b = out.tileGrid.biome;
    expect(b[9 * W + 9]).toBe(5); // BIOME.DEEP_WATER — lone center tile
    // Shore-facing edge of the lake (distance 6 from center): still shallow.
    expect(b[3 * W + 9]).toBe(4); // BIOME.SHALLOW_WATER
    expect(b[1 * W + 9]).toBe(3); // sand shore stays sand
    expect(b[0]).toBe(1); // dirt border untouched
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
