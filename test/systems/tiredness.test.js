import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { makeTirednessSystem } from '../../src/systems/cow.js';

function makeWorld() {
  const w = new World();
  registerComponents(w);
  return w;
}

describe('tirednessDrain', () => {
  it('drains Tiredness.value toward 0 on each run', () => {
    const w = makeWorld();
    const id = w.spawn({
      Tiredness: { value: 1 },
      Brain: { name: 'test' },
    });
    const sys = makeTirednessSystem();
    sys.run(w, /** @type {any} */ ({}));
    const t = w.get(id, 'Tiredness');
    expect(t.value).toBeLessThan(1);
    expect(t.value).toBeGreaterThan(0.99);
  });

  it('clamps at 0 and never goes negative', () => {
    const w = makeWorld();
    const id = w.spawn({
      Tiredness: { value: 0.0001 },
      Brain: { name: 'test' },
    });
    const sys = makeTirednessSystem();
    for (let i = 0; i < 100; i++) sys.run(w, /** @type {any} */ ({}));
    expect(w.get(id, 'Tiredness').value).toBe(0);
  });

  it('ignores entities without a Brain component', () => {
    const w = makeWorld();
    const id = w.spawn({
      Tiredness: { value: 1 },
    });
    const sys = makeTirednessSystem();
    sys.run(w, /** @type {any} */ ({}));
    expect(w.get(id, 'Tiredness').value).toBe(1);
  });
});
