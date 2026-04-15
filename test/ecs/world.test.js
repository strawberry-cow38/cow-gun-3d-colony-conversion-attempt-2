import { describe, expect, it, vi } from 'vitest';
import { World } from '../../src/ecs/world.js';

const GEN_MAX = 0xffff;

describe('World', () => {
  it('spawns and reads components', () => {
    const w = new World();
    w.defineComponent('Position', () => ({ x: 0, y: 0, z: 0 }));
    const e = w.spawn({ Position: { x: 5 } });
    expect(w.get(e, 'Position')).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('throws on unknown component', () => {
    const w = new World();
    expect(() => w.spawn({ Nope: {} })).toThrow(/unknown component/);
  });

  it('throws on duplicate component definition', () => {
    const w = new World();
    w.defineComponent('A', () => ({}));
    expect(() => w.defineComponent('A', () => ({}))).toThrow(/already defined/);
  });

  it('despawns and recycles slots with bumped generation', () => {
    const w = new World();
    w.defineComponent('A', () => ({ v: 0 }));
    const e1 = w.spawn({ A: { v: 1 } });
    w.despawn(e1);
    const e2 = w.spawn({ A: { v: 2 } });
    expect(w.get(e1, 'A')).toBeUndefined();
    expect(w.get(e2, 'A')).toEqual({ v: 2 });
    expect(e1).not.toBe(e2);
  });

  it('despawn is no-op on stale id', () => {
    const w = new World();
    w.defineComponent('A', () => ({}));
    const e = w.spawn({ A: {} });
    w.despawn(e);
    expect(() => w.despawn(e)).not.toThrow();
  });

  it('groups entities into archetypes by component set', () => {
    const w = new World();
    w.defineComponent('A', () => ({}));
    w.defineComponent('B', () => ({}));
    w.spawn({ A: {} });
    w.spawn({ A: {} });
    w.spawn({ A: {}, B: {} });
    expect(w.archetypes.size).toBe(2);
  });

  it('query yields entities matching all requested components', () => {
    const w = new World();
    w.defineComponent('A', () => ({ tag: 'a' }));
    w.defineComponent('B', () => ({ tag: 'b' }));
    w.spawn({ A: {} });
    const ab1 = w.spawn({ A: {}, B: {} });
    const ab2 = w.spawn({ A: {}, B: {} });

    const ids = [];
    for (const { id } of w.query(['A', 'B'])) ids.push(id);
    ids.sort();
    expect(ids).toEqual([ab1, ab2].sort());
  });

  it('query yields the same component objects (mutation persists)', () => {
    const w = new World();
    w.defineComponent('Pos', () => ({ x: 0 }));
    w.spawn({ Pos: { x: 1 } });
    for (const { components } of w.query(['Pos'])) components.Pos.x = 99;
    for (const { components } of w.query(['Pos'])) expect(components.Pos.x).toBe(99);
  });

  it('despawn does not corrupt other entities in same archetype (swap-with-last)', () => {
    const w = new World();
    w.defineComponent('V', () => ({ v: 0 }));
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(w.spawn({ V: { v: i } }));
    w.despawn(ids[1]);
    w.despawn(ids[3]);
    const survivors = [];
    for (const { components } of w.query(['V'])) survivors.push(components.V.v);
    survivors.sort();
    expect(survivors).toEqual([0, 2, 4]);
    expect(w.entityCount).toBe(3);
  });

  it('entityCount tracks live entities', () => {
    const w = new World();
    w.defineComponent('A', () => ({}));
    expect(w.entityCount).toBe(0);
    const e = w.spawn({ A: {} });
    expect(w.entityCount).toBe(1);
    w.despawn(e);
    expect(w.entityCount).toBe(0);
  });

  it('retires a slot once its generation counter saturates', () => {
    const w = new World();
    w.defineComponent('A', () => ({}));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Burn the first slot's generation down to max by cycling spawn/despawn
    // until only that slot is on freeSlots. Brand-new slots start at gen=1
    // and each reuse bumps by one until it hits GEN_MAX, after which the
    // slot should retire (not recycle).
    let cycles = 0;
    let lastSlotIndex = -1;
    while (cycles < GEN_MAX + 2) {
      const id = w.spawn({ A: {} });
      lastSlotIndex = id & 0xffff;
      // Stop only after we've seen a second-slot allocation, which means the
      // first slot retired and we're now growing the table.
      if (lastSlotIndex !== 0) break;
      w.despawn(id);
      cycles++;
    }
    expect(cycles).toBeGreaterThanOrEqual(GEN_MAX);
    expect(lastSlotIndex).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('DEV-mode: spreading a query throws on any later access (wrapper contract)', () => {
    const w = new World();
    w.defineComponent('A', () => ({ v: 0 }));
    w.spawn({ A: { v: 1 } });
    w.spawn({ A: { v: 2 } });
    const collected = [...w.query(['A'])];
    // Each collected wrapper has been revoked by the next iteration (or by
    // generator cleanup for the final one), so any property read throws.
    for (const item of collected) {
      expect(() => item.id).toThrow(/revoked/);
    }
  });
});
