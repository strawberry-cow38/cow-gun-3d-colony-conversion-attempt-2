import { describe, expect, it } from 'vitest';
import { DirtyBus, Scheduler, TIER_PERIODS } from '../../src/ecs/schedule.js';
import { World } from '../../src/ecs/world.js';

describe('Scheduler tier cadences', () => {
  it("'every' systems run every tick", () => {
    const s = new Scheduler();
    const w = new World();
    let count = 0;
    s.add({ name: 'a', tier: 'every', run: () => count++ });
    for (let t = 0; t < 10; t++) s.tick(w, t, 1 / 30);
    expect(count).toBe(10);
  });

  it("'rare' systems run once per TIER_PERIODS.rare", () => {
    const s = new Scheduler();
    const w = new World();
    let count = 0;
    s.add({ name: 'a', tier: 'rare', offset: 0, run: () => count++ });
    const ticks = TIER_PERIODS.rare * 8;
    for (let t = 0; t < ticks; t++) s.tick(w, t, 1 / 30);
    expect(count).toBe(8);
  });

  it("'long' systems run once per TIER_PERIODS.long", () => {
    const s = new Scheduler();
    const w = new World();
    let count = 0;
    s.add({ name: 'a', tier: 'long', offset: 0, run: () => count++ });
    const ticks = TIER_PERIODS.long * 4;
    for (let t = 0; t < ticks; t++) s.tick(w, t, 1 / 30);
    expect(count).toBe(4);
  });

  it("'dirty' systems only run when their tag is set", () => {
    const s = new Scheduler();
    const w = new World();
    let count = 0;
    s.add({
      name: 'd',
      tier: 'dirty',
      dirtyTag: 'pathfind',
      run(_w, ctx) {
        count++;
        ctx.dirty.consume('pathfind');
      },
    });
    for (let t = 0; t < 5; t++) s.tick(w, t, 1 / 30);
    expect(count).toBe(0);
    s.dirty.mark('pathfind');
    s.tick(w, 5, 1 / 30);
    expect(count).toBe(1);
    s.tick(w, 6, 1 / 30);
    expect(count).toBe(1);
  });

  it("rejects 'dirty' tier without a dirtyTag", () => {
    const s = new Scheduler();
    expect(() => s.add({ name: 'x', tier: 'dirty', run: () => {} })).toThrow(/dirtyTag/);
  });

  it('records timing per system', () => {
    const s = new Scheduler();
    const w = new World();
    s.add({ name: 'slow', tier: 'every', run: () => {} });
    s.tick(w, 0, 1 / 30);
    expect(s.lastMs.has('slow')).toBe(true);
    expect(s.avgMs.has('slow')).toBe(true);
  });
});

describe('DirtyBus', () => {
  it('mark / has / consume cycle', () => {
    const d = new DirtyBus();
    expect(d.has('x')).toBe(false);
    d.mark('x');
    expect(d.has('x')).toBe(true);
    d.consume('x');
    expect(d.has('x')).toBe(false);
  });
});
