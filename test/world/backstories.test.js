import { describe, expect, it } from 'vitest';
import { pickChildhood, pickProfession } from '../../src/world/backstories.js';

describe('backstories', () => {
  it('returns a non-empty string for every title', () => {
    for (const title of ['Mr.', 'Mrs.', 'Ms.', 'Mx.', 'Dr.', 'Prof.', 'Col.']) {
      const c = pickChildhood(title, () => 0.5);
      const p = pickProfession(title, () => 0.5);
      expect(typeof c).toBe('string');
      expect(c.length).toBeGreaterThan(0);
      expect(typeof p).toBe('string');
      expect(p.length).toBeGreaterThan(0);
    }
  });

  it('prefers Col.-specific professions when Col. rolls the specific branch', () => {
    // rng() < 0.7 triggers the specific pool; use a low value to force it.
    const seq = [0.1, 0.0];
    const rng = () => seq.shift() ?? 0;
    const p = pickProfession('Col.', rng);
    expect(p).toMatch(
      /Stateside Base|Private Military|Desert Storm|ROTC|Military Surplus|Survivalist|Pentagon|Korean War|Marine|Airborne|VFW|Private Security|National Guard|Drill Sergeant|Submarine|Control Tower/,
    );
  });

  it('falls back to generic pool when the Col. branch rolls generic', () => {
    // First rng() >= 0.7 kicks to generic; second picks index.
    const seq = [0.9, 0.0];
    const rng = () => seq.shift() ?? 0;
    const p = pickProfession('Col.', rng);
    // Generic pool starts with "Used Tire Salesman".
    expect(p).toBe('Used Tire Salesman');
  });

  it('never returns a Dr.-only profession for a Mr. cow', () => {
    const mrHits = new Set();
    const rng = mulberry32(42);
    for (let i = 0; i < 500; i++) mrHits.add(pickProfession('Mr.', rng));
    for (const text of mrHits) {
      expect(text).not.toMatch(/St. Elsewhere|RAND Corporation|Poultry Geneticist|Adjunct/);
    }
  });
});

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
