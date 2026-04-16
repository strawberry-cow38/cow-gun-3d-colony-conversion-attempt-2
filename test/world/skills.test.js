import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import {
  MAX_LEVEL,
  SKILL_IDS,
  XP_PER_WORK,
  awardXp,
  rollStartingSkills,
  skillFactor,
  skillFactorFor,
  skillLevelFor,
  xpForNextLevel,
} from '../../src/world/skills.js';

function seededRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function makeWorld() {
  const w = new World();
  registerComponents(w);
  return w;
}

describe('xpForNextLevel', () => {
  it('is linear with level', () => {
    expect(xpForNextLevel(0)).toBe(1000);
    expect(xpForNextLevel(1)).toBe(1500);
    expect(xpForNextLevel(9)).toBe(5500);
    expect(xpForNextLevel(19)).toBe(10500);
  });

  it('treats negative levels as zero', () => {
    expect(xpForNextLevel(-5)).toBe(1000);
  });
});

describe('skillFactor', () => {
  it('clamps to [0, 1]', () => {
    expect(skillFactor(0)).toBe(0);
    expect(skillFactor(MAX_LEVEL)).toBe(1);
    expect(skillFactor(MAX_LEVEL * 2)).toBe(1);
    expect(skillFactor(-10)).toBe(0);
  });
});

describe('awardXp', () => {
  it('advances level when threshold crossed', () => {
    const world = makeWorld();
    const id = world.spawn({
      Skills: { levels: { cooking: { level: 0, xp: 0 } }, learnRateMultiplier: 1 },
    });
    const gained = awardXp(world, id, 'cooking', 1500);
    expect(gained).toBe(1);
    const entry = world.get(id, 'Skills').levels.cooking;
    expect(entry.level).toBe(1);
    expect(entry.xp).toBe(500);
  });

  it('caps at MAX_LEVEL', () => {
    const world = makeWorld();
    const id = world.spawn({
      Skills: { levels: { cooking: { level: MAX_LEVEL, xp: 0 } }, learnRateMultiplier: 1 },
    });
    const gained = awardXp(world, id, 'cooking', 100_000);
    expect(gained).toBe(0);
    expect(world.get(id, 'Skills').levels.cooking.level).toBe(MAX_LEVEL);
  });

  it('honors learnRateMultiplier', () => {
    const world = makeWorld();
    const id = world.spawn({
      Skills: { levels: { cooking: { level: 0, xp: 0 } }, learnRateMultiplier: 2 },
    });
    awardXp(world, id, 'cooking', 500);
    // 500 * 2 = 1000 xp → exactly one level
    expect(world.get(id, 'Skills').levels.cooking.level).toBe(1);
  });

  it('is a no-op for cowId <= 0 or missing Skills', () => {
    const world = makeWorld();
    expect(awardXp(world, 0, 'cooking', XP_PER_WORK)).toBe(0);
    const id = world.spawn({ Cow: {} });
    expect(awardXp(world, id, 'cooking', XP_PER_WORK)).toBe(0);
  });
});

describe('skillLevelFor / skillFactorFor', () => {
  it('returns 0 for missing Skills', () => {
    const world = makeWorld();
    const id = world.spawn({ Cow: {} });
    expect(skillLevelFor(world, id, 'cooking')).toBe(0);
    expect(skillFactorFor(world, id, 'cooking')).toBe(0);
  });

  it('reads the stored level', () => {
    const world = makeWorld();
    const id = world.spawn({
      Skills: { levels: { cooking: { level: 10, xp: 0 } }, learnRateMultiplier: 1 },
    });
    expect(skillLevelFor(world, id, 'cooking')).toBe(10);
    expect(skillFactorFor(world, id, 'cooking')).toBeCloseTo(0.5, 5);
  });
});

describe('rollStartingSkills', () => {
  it('returns an entry for every skill id, within bounds', () => {
    const { levels } = rollStartingSkills({ rng: seededRng(42), ageYears: 30 });
    for (const id of SKILL_IDS) {
      const entry = levels[id];
      expect(entry).toBeTruthy();
      expect(entry.level).toBeGreaterThanOrEqual(0);
      expect(entry.level).toBeLessThanOrEqual(MAX_LEVEL);
      expect(entry.xp).toBe(0);
    }
  });

  it('applies profession bonus meaningfully', () => {
    let totalWith = 0;
    let totalWithout = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const a = rollStartingSkills({
        rng: seededRng(1000 + i),
        ageYears: 30,
        professionBonus: { cooking: 8 },
      });
      const b = rollStartingSkills({ rng: seededRng(1000 + i), ageYears: 30 });
      totalWith += a.levels.cooking.level;
      totalWithout += b.levels.cooking.level;
    }
    expect(totalWith / N).toBeGreaterThan(totalWithout / N + 3);
  });

  it('applies childhood bonus at smaller weight than profession', () => {
    let totalProf = 0;
    let totalChild = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      totalProf += rollStartingSkills({
        rng: seededRng(2000 + i),
        ageYears: 30,
        professionBonus: { mining: 5 },
      }).levels.mining.level;
      totalChild += rollStartingSkills({
        rng: seededRng(2000 + i),
        ageYears: 30,
        childhoodBonus: { mining: 5 },
      }).levels.mining.level;
    }
    expect(totalProf / N).toBeGreaterThan(totalChild / N);
  });

  it('defaults learnRateMultiplier to ~1', () => {
    let sum = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      sum += rollStartingSkills({ rng: seededRng(3000 + i), ageYears: 30 }).learnRateMultiplier;
    }
    const mean = sum / N;
    expect(mean).toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(1.1);
  });
});
