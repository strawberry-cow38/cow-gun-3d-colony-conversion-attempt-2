import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TO_KINDS,
  DEFAULT_PRIORITY,
  KIND_TO_CATEGORIES,
  MAX_PRIORITY,
  WORK_CATEGORIES,
  canCowDoJobKind,
  deriveDefaultsFromSkills,
  priorityForJobKind,
  sanitizePriorities,
} from '../../src/world/workPriorities.js';

describe('deriveDefaultsFromSkills', () => {
  it('enables haul and art regardless of skills', () => {
    const { priorities } = deriveDefaultsFromSkills({ levels: {} });
    expect(priorities.haul).toBe(DEFAULT_PRIORITY);
    expect(priorities.art).toBe(DEFAULT_PRIORITY);
  });

  it('disables skill-gated categories below the threshold', () => {
    const { priorities } = deriveDefaultsFromSkills({
      levels: {
        cooking: { level: 0 },
        construction: { level: 2 },
        mining: { level: 1 },
        crafting: { level: 0 },
        plants: { level: 0 },
      },
    });
    expect(priorities.cooking).toBe(0);
    expect(priorities.construction).toBe(0);
    expect(priorities.mining).toBe(0);
    expect(priorities.crafting).toBe(0);
    expect(priorities.growing).toBe(0);
  });

  it('enables skill-gated categories at or above the threshold', () => {
    const { priorities } = deriveDefaultsFromSkills({
      levels: {
        cooking: { level: 3 },
        construction: { level: 8 },
        mining: { level: 3 },
        crafting: { level: 5 },
        plants: { level: 10 },
      },
    });
    expect(priorities.cooking).toBe(DEFAULT_PRIORITY);
    expect(priorities.construction).toBe(DEFAULT_PRIORITY);
    expect(priorities.mining).toBe(DEFAULT_PRIORITY);
    expect(priorities.crafting).toBe(DEFAULT_PRIORITY);
    expect(priorities.growing).toBe(DEFAULT_PRIORITY);
  });

  it('tolerates a missing Skills component', () => {
    const { priorities } = deriveDefaultsFromSkills(undefined);
    for (const cat of WORK_CATEGORIES) {
      expect(priorities[cat]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('canCowDoJobKind', () => {
  it('returns true when the owning category is enabled', () => {
    const wp = { priorities: { construction: DEFAULT_PRIORITY, haul: 0 } };
    expect(canCowDoJobKind(wp, 'build')).toBe(true);
    expect(canCowDoJobKind(wp, 'deliver')).toBe(true);
  });

  it('returns false when every owning category is disabled', () => {
    const wp = { priorities: { construction: 0, haul: 0 } };
    expect(canCowDoJobKind(wp, 'build')).toBe(false);
    expect(canCowDoJobKind(wp, 'install')).toBe(false);
  });

  it('install/uninstall enable via EITHER haul or construction', () => {
    expect(canCowDoJobKind({ priorities: { haul: 1, construction: 0 } }, 'install')).toBe(true);
    expect(canCowDoJobKind({ priorities: { haul: 0, construction: 1 } }, 'install')).toBe(true);
    expect(canCowDoJobKind({ priorities: { haul: 0, construction: 0 } }, 'install')).toBe(false);
    expect(canCowDoJobKind({ priorities: { haul: 1, construction: 0 } }, 'uninstall')).toBe(true);
    expect(canCowDoJobKind({ priorities: { haul: 0, construction: 1 } }, 'uninstall')).toBe(true);
  });

  it('soft-passes unknown kinds', () => {
    expect(canCowDoJobKind({ priorities: {} }, 'wander')).toBe(true);
    expect(canCowDoJobKind({ priorities: {} }, 'eat')).toBe(true);
  });

  it('soft-passes when the component is missing', () => {
    expect(canCowDoJobKind(undefined, 'build')).toBe(true);
  });
});

describe('priorityForJobKind', () => {
  it('returns the lowest priority across owning categories', () => {
    const wp = { priorities: { haul: 2, construction: 5 } };
    expect(priorityForJobKind(wp, 'install')).toBe(2);
  });

  it('returns 0 when disabled', () => {
    const wp = { priorities: { haul: 0, construction: 0 } };
    expect(priorityForJobKind(wp, 'install')).toBe(0);
  });

  it('returns DEFAULT_PRIORITY for unknown kinds / missing component', () => {
    expect(priorityForJobKind({ priorities: {} }, 'wander')).toBe(DEFAULT_PRIORITY);
    expect(priorityForJobKind(undefined, 'build')).toBe(DEFAULT_PRIORITY);
  });
});

describe('category wiring', () => {
  it('KIND_TO_CATEGORIES inverts CATEGORY_TO_KINDS', () => {
    for (const cat of WORK_CATEGORIES) {
      for (const kind of CATEGORY_TO_KINDS[cat]) {
        expect(KIND_TO_CATEGORIES[kind]).toContain(cat);
      }
    }
  });

  it('install and uninstall belong to both haul and construction', () => {
    expect(KIND_TO_CATEGORIES.install).toEqual(expect.arrayContaining(['haul', 'construction']));
    expect(KIND_TO_CATEGORIES.uninstall).toEqual(expect.arrayContaining(['haul', 'construction']));
  });

  it('deliver belongs to construction, supply belongs to crafting, paint to art', () => {
    expect(KIND_TO_CATEGORIES.deliver).toEqual(['construction']);
    expect(KIND_TO_CATEGORIES.supply).toEqual(['crafting']);
    expect(KIND_TO_CATEGORIES.paint).toEqual(['art']);
  });

  it('plant/till/harvest all route to growing', () => {
    for (const k of ['chop', 'cut', 'till', 'plant', 'harvest']) {
      expect(KIND_TO_CATEGORIES[k]).toEqual(['growing']);
    }
  });
});

describe('sanitizePriorities', () => {
  it('clamps to [0, MAX_PRIORITY] and defaults missing keys to 0', () => {
    const out = sanitizePriorities({ haul: -3, cooking: 99, mining: 4.7 });
    expect(out.haul).toBe(0);
    expect(out.cooking).toBe(MAX_PRIORITY);
    expect(out.mining).toBe(4);
    expect(out.art).toBe(0);
  });

  it('returns all-zero when given garbage input', () => {
    const out = sanitizePriorities(null);
    for (const cat of WORK_CATEGORIES) expect(out[cat]).toBe(0);
  });
});
