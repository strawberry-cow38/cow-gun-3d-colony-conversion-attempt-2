import { describe, expect, it } from 'vitest';
import {
  QUALITY_TIERS,
  ingredientsSig,
  nutritionMultiplier,
  poisoningChance,
  qualityRank,
  rollQuality,
} from '../../src/world/quality.js';

describe('quality ranks', () => {
  it('orders tiers low to high', () => {
    expect(qualityRank('inedible')).toBe(0);
    expect(qualityRank('gourmet')).toBe(QUALITY_TIERS.length - 1);
    expect(qualityRank('tasty')).toBeGreaterThan(qualityRank('decent'));
    expect(qualityRank('nonsense')).toBe(-1);
  });
});

describe('poisoning chance', () => {
  it('is zero at tasty and above', () => {
    expect(poisoningChance('tasty')).toBe(0);
    expect(poisoningChance('delicious')).toBe(0);
    expect(poisoningChance('gourmet')).toBe(0);
  });

  it('is non-zero below tasty', () => {
    expect(poisoningChance('inedible')).toBeGreaterThan(0);
    expect(poisoningChance('unpleasant')).toBeGreaterThan(0);
    expect(poisoningChance('decent')).toBeGreaterThan(0);
  });

  it('shrinks as quality rises', () => {
    expect(poisoningChance('decent')).toBeLessThan(poisoningChance('unpleasant'));
    expect(poisoningChance('unpleasant')).toBeLessThan(poisoningChance('inedible'));
  });
});

describe('nutrition multiplier', () => {
  it('favors higher quality', () => {
    expect(nutritionMultiplier('decent')).toBe(1);
    expect(nutritionMultiplier('tasty')).toBeGreaterThan(1);
    expect(nutritionMultiplier('gourmet')).toBeGreaterThan(nutritionMultiplier('lavish'));
    expect(nutritionMultiplier('inedible')).toBeLessThan(1);
  });
});

describe('rollQuality', () => {
  it('produces a valid tier for any skill level', () => {
    const rng = mulberryRng(1);
    for (const skill of [0, 0.25, 0.5, 0.75, 1]) {
      for (let i = 0; i < 32; i++) {
        const q = rollQuality(skill, rng);
        expect(QUALITY_TIERS).toContain(q);
      }
    }
  });

  it('averages higher with higher skill', () => {
    const rng = mulberryRng(42);
    const low = avgRank(rollMany(0.1, rng, 200));
    const high = avgRank(rollMany(0.9, rng, 200));
    expect(high).toBeGreaterThan(low);
  });
});

describe('ingredientsSig', () => {
  it('normalizes ingredient order', () => {
    expect(ingredientsSig(['food', 'wood'])).toBe(ingredientsSig(['wood', 'food']));
  });

  it('differs when ingredients differ', () => {
    expect(ingredientsSig(['food'])).not.toBe(ingredientsSig(['food', 'wood']));
  });

  it('returns empty for no ingredients', () => {
    expect(ingredientsSig([])).toBe('');
  });
});

/** @param {number} skill @param {() => number} rng @param {number} n */
function rollMany(skill, rng, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(rollQuality(skill, rng));
  return out;
}

/** @param {string[]} qs */
function avgRank(qs) {
  let s = 0;
  for (const q of qs) s += qualityRank(q);
  return s / qs.length;
}

/** Tiny deterministic PRNG so tests don't wobble. */
function mulberryRng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
