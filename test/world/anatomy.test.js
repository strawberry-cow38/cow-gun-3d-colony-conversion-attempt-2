import { describe, expect, it } from 'vitest';
import {
  CAPACITIES,
  HUMAN_ANATOMY,
  computeCapacities,
  getPart,
  hasLethalDamage,
  partHp,
  partHpRatio,
  totalBleedRate,
} from '../../src/world/anatomy.js';

/**
 * @param {string} partId
 * @param {number} severity
 * @param {Partial<import('../../src/world/anatomy.js').Injury>} [extra]
 * @returns {import('../../src/world/anatomy.js').Injury}
 */
function injury(partId, severity, extra = {}) {
  return {
    id: 1,
    partId,
    type: 'Cut',
    severity,
    bleedRate: 0,
    infection: 0,
    tended: false,
    tendQuality: 0,
    permanent: false,
    appliedAtTick: 0,
    ...extra,
  };
}

/** @param {string} id */
function part(id) {
  const p = getPart(id);
  if (!p) throw new Error(`test bug: unknown part ${id}`);
  return p;
}

describe('anatomy capacities', () => {
  it('all capacities are 1.0 on an uninjured body', () => {
    const caps = computeCapacities([]);
    for (const c of CAPACITIES) {
      expect(caps[c]).toBeCloseTo(1, 5);
    }
  });

  it('destroying the brain zeroes out Consciousness and gates everything else', () => {
    const caps = computeCapacities([injury('brain', part('brain').maxHp)]);
    expect(caps.Consciousness).toBe(0);
    // Other capacities are capped to consciousness level.
    for (const c of CAPACITIES) expect(caps[c]).toBe(0);
  });

  it('losing one eye halves Sight', () => {
    const caps = computeCapacities([injury('left_eye', part('left_eye').maxHp)]);
    expect(caps.Sight).toBeCloseTo(0.5, 5);
  });

  it('destroying one leg drops Moving but does not zero it', () => {
    const caps = computeCapacities([injury('left_leg', part('left_leg').maxHp)]);
    // Left leg contributes 0.35; remaining capacities sum to 0.65.
    expect(caps.Moving).toBeCloseTo(0.65, 5);
    expect(caps.Consciousness).toBe(1);
    expect(caps.Sight).toBe(1);
  });

  it('partial damage scales the capacity contribution proportionally', () => {
    const caps = computeCapacities([injury('heart', part('heart').maxHp / 2)]);
    // Heart owns 100% of BloodPumping, so half HP = half capacity.
    expect(caps.BloodPumping).toBeCloseTo(0.5, 5);
  });
});

describe('anatomy part HP', () => {
  it('partHp subtracts all injuries on that part', () => {
    const leg = part('left_leg');
    const injuries = [injury('left_leg', 5), injury('left_leg', 7), injury('right_leg', 100)];
    expect(partHp('left_leg', injuries)).toBe(leg.maxHp - 12);
    expect(partHpRatio('left_leg', injuries)).toBeCloseTo((leg.maxHp - 12) / leg.maxHp, 5);
  });

  it('partHp clamps at 0 even with over-damage', () => {
    expect(partHp('left_lung', [injury('left_lung', 9999)])).toBe(0);
    expect(partHpRatio('left_lung', [injury('left_lung', 9999)])).toBe(0);
  });

  it('container parts have ratio 1 regardless of child damage', () => {
    // Head/Torso are containers with maxHp=0. They're never themselves "damaged"
    // — their children take the hits. Ratio stays 1 so the row doesn't go red.
    expect(partHpRatio('head', [injury('brain', 100)])).toBe(1);
    expect(partHpRatio('torso', [injury('heart', 100)])).toBe(1);
  });
});

describe('anatomy bleed + lethality', () => {
  it('totalBleedRate sums untended bleed rates', () => {
    const injuries = [
      injury('left_arm', 5, { bleedRate: 0.3 }),
      injury('right_arm', 5, { bleedRate: 0.2 }),
    ];
    expect(totalBleedRate(injuries)).toBeCloseTo(0.5, 5);
  });

  it('tendQuality reduces bleed rate proportionally', () => {
    const injuries = [injury('left_arm', 5, { bleedRate: 1, tended: true, tendQuality: 0.75 })];
    expect(totalBleedRate(injuries)).toBeCloseTo(0.25, 5);
  });

  it('hasLethalDamage triggers on any vital part destruction', () => {
    expect(hasLethalDamage([injury('heart', part('heart').maxHp)])).toBe(true);
    expect(hasLethalDamage([injury('left_arm', 999)])).toBe(false);
  });
});

describe('HUMAN_ANATOMY sanity', () => {
  it('every part id is unique', () => {
    const ids = new Set();
    for (const p of HUMAN_ANATOMY) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
    }
  });

  it('every parentId references a real part or is null', () => {
    const ids = new Set(HUMAN_ANATOMY.map((p) => p.id));
    for (const p of HUMAN_ANATOMY) {
      if (p.parentId === null) continue;
      expect(ids.has(p.parentId)).toBe(true);
    }
  });
});
