import { describe, expect, it } from 'vitest';
import { createStockpileZones } from '../../src/systems/stockpileZones.js';
import { TileGrid } from '../../src/world/tileGrid.js';

function makeGridWithZones(W = 8, H = 8) {
  const grid = new TileGrid(W, H);
  const zones = createStockpileZones(grid);
  return { grid, zones };
}

/** @type {<T>(v: T | null) => T} */
function must(v) {
  if (v === null) throw new Error('expected non-null');
  return v;
}

describe('stockpileZones: createZone', () => {
  it('creates a zone and flags each tile in the underlying grid', () => {
    const { grid, zones } = makeGridWithZones();
    const z = must(zones.createZone([grid.idx(1, 1), grid.idx(1, 2)]));
    expect(z.tiles.size).toBe(2);
    expect(grid.isStockpile(1, 1)).toBe(true);
    expect(grid.isStockpile(1, 2)).toBe(true);
    expect(zones.zoneIdAt(1, 1)).toBe(z.id);
  });

  it('skips tile indices that already belong to another zone', () => {
    const { grid, zones } = makeGridWithZones();
    const first = must(zones.createZone([grid.idx(1, 1)]));
    const second = must(zones.createZone([grid.idx(1, 1), grid.idx(2, 2)]));
    expect(second.tiles.size).toBe(1);
    expect(zones.zoneIdAt(1, 1)).toBe(first.id);
    expect(zones.zoneIdAt(2, 2)).toBe(second.id);
  });

  it('returns null when every candidate tile is already owned', () => {
    const { grid, zones } = makeGridWithZones();
    zones.createZone([grid.idx(1, 1)]);
    const z = zones.createZone([grid.idx(1, 1)]);
    expect(z).toBeNull();
  });

  it('seeds default allowed kinds (every category except junk)', () => {
    const { grid, zones } = makeGridWithZones();
    const z = must(zones.createZone([grid.idx(0, 0)]));
    expect(z.allowedKinds.has('wood')).toBe(true);
    expect(z.allowedKinds.has('meal')).toBe(true);
    expect(z.allowedKinds.has('copper')).toBe(true);
  });
});

describe('stockpileZones: mergeZones', () => {
  it('consolidates multiple zones into the lowest-id survivor', () => {
    const { grid, zones } = makeGridWithZones();
    const a = must(zones.createZone([grid.idx(1, 1)]));
    const b = must(zones.createZone([grid.idx(5, 5)]));
    const survivor = zones.mergeZones([a.id, b.id]);
    expect(survivor).toBe(a.id);
    expect(zones.zoneById(b.id)).toBeNull();
    expect(zones.zoneIdAt(5, 5)).toBe(a.id);
    expect(must(zones.zoneById(a.id)).tiles.size).toBe(2);
  });

  it('unions allowed-kinds from every merged zone', () => {
    const { grid, zones } = makeGridWithZones();
    const a = must(zones.createZone([grid.idx(1, 1)]));
    const b = must(zones.createZone([grid.idx(5, 5)]));
    // a = wood only; b = stone only. After merge, survivor has both.
    zones.setAllowed(a.id, 'stone', false);
    zones.setAllowed(b.id, 'wood', false);
    zones.mergeZones([a.id, b.id]);
    const merged = must(zones.zoneById(a.id));
    expect(merged.allowedKinds.has('wood')).toBe(true);
    expect(merged.allowedKinds.has('stone')).toBe(true);
  });

  it('no-op when only one id is supplied', () => {
    const { grid, zones } = makeGridWithZones();
    const a = must(zones.createZone([grid.idx(1, 1)]));
    expect(zones.mergeZones([a.id])).toBe(a.id);
  });
});

describe('stockpileZones: removeTiles', () => {
  it('shrinks the zone and clears the grid flag', () => {
    const { grid, zones } = makeGridWithZones();
    const z = must(zones.createZone([grid.idx(1, 1), grid.idx(1, 2)]));
    zones.removeTiles([grid.idx(1, 1)]);
    expect(grid.isStockpile(1, 1)).toBe(false);
    expect(z.tiles.size).toBe(1);
    expect(zones.zoneIdAt(1, 1)).toBe(0);
    expect(zones.zoneById(z.id)).not.toBeNull();
  });

  it('deletes the zone entirely when its last tile is removed', () => {
    const { grid, zones } = makeGridWithZones();
    const z = must(zones.createZone([grid.idx(1, 1)]));
    zones.removeTiles([grid.idx(1, 1)]);
    expect(zones.zoneById(z.id)).toBeNull();
    expect(grid.isStockpile(1, 1)).toBe(false);
  });
});

describe('stockpileZones: allowsAt', () => {
  it('true for a zone tile when kind is in its filter', () => {
    const { grid, zones } = makeGridWithZones();
    zones.createZone([grid.idx(1, 1)]);
    expect(zones.allowsAt(1, 1, 'wood')).toBe(true);
  });

  it('false once the filter drops the kind', () => {
    const { grid, zones } = makeGridWithZones();
    const z = must(zones.createZone([grid.idx(1, 1)]));
    zones.setAllowed(z.id, 'wood', false);
    expect(zones.allowsAt(1, 1, 'wood')).toBe(false);
  });

  it('false for a tile that has no zone at all', () => {
    const { zones } = makeGridWithZones();
    expect(zones.allowsAt(3, 3, 'wood')).toBe(false);
  });
});

describe('stockpileZones: hydrateFromGrid', () => {
  it('flood-fills 4-connected stockpile runs into one zone each', () => {
    const { grid, zones } = makeGridWithZones();
    grid.setStockpile(1, 1, 1);
    grid.setStockpile(1, 2, 1);
    grid.setStockpile(5, 5, 1);
    zones.hydrateFromGrid();
    expect(zones.zoneIdAt(1, 1)).toBe(zones.zoneIdAt(1, 2));
    expect(zones.zoneIdAt(5, 5)).not.toBe(zones.zoneIdAt(1, 1));
  });
});

describe('stockpileZones: onChanged', () => {
  it('fires on create, extend, merge, remove, and setAllowed (on actual change)', () => {
    const { grid, zones } = makeGridWithZones();
    let n = 0;
    zones.setOnChanged(() => {
      n++;
    });
    const z = must(zones.createZone([grid.idx(1, 1)]));
    expect(n).toBe(1);
    zones.extendZone(z.id, [grid.idx(1, 2)]);
    expect(n).toBe(2);
    zones.setAllowed(z.id, 'wood', false);
    expect(n).toBe(3);
    // Redundant setAllowed — already disallowed, no fire.
    zones.setAllowed(z.id, 'wood', false);
    expect(n).toBe(3);
    zones.removeTiles([grid.idx(1, 1)]);
    expect(n).toBe(4);
  });
});
