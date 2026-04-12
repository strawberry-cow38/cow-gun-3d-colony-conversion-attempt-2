import { describe, expect, it } from 'vitest';
import { SIM_DT, SIM_HZ, SimLoop } from '../../src/sim/loop.js';

describe('SimLoop constants', () => {
  it('SIM_HZ is 30 per ARCHITECTURE.md §6', () => {
    expect(SIM_HZ).toBe(30);
  });
  it('SIM_DT is 1/30', () => {
    expect(SIM_DT).toBeCloseTo(1 / 30, 10);
  });
});

describe('SimLoop accumulator semantics', () => {
  // We don't actually drive RAF here — we test the public surface that doesn't
  // require browser. Direct accumulator math is asserted via constants and DT.
  it('constructs without throwing and exposes expected fields', () => {
    const loop = new SimLoop({ step: () => {}, render: () => {}, now: () => 0 });
    expect(loop.tick).toBe(0);
    expect(loop.accumulator).toBe(0);
    expect(loop.measuredHz).toBe(0);
    expect(loop.lastSteps).toBe(0);
    expect(loop.running).toBe(false);
  });
});
