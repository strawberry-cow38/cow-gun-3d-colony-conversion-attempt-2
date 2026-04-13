/**
 * Weather state machine + registry.
 *
 * Each kind implements `{ enter(), tick(dt, camPos), exit() }`. Adding a new
 * weather (snow, fog, storm…) is a one-entry-per-kind addition here plus any
 * renderer it needs — no changes to main.js or the HUD beyond an optional
 * label.
 *
 * Weather tweaks time-of-day via `setOvercast` rather than owning its own
 * lights, so rain during dawn still reads as "dim sunrise" instead of
 * stomping on the palette.
 */

import { createRainParticles } from '../render/rainParticles.js';

export const WEATHER_KINDS = /** @type {const} */ (['clear', 'rain']);

/** @typedef {(typeof WEATHER_KINDS)[number]} WeatherKind */

/**
 * @param {{
 *   scene: import('three').Scene,
 *   timeOfDay: import('./timeOfDay.js').TimeOfDay,
 * }} opts
 */
export function createWeather(opts) {
  const { scene, timeOfDay } = opts;
  const rain = createRainParticles(scene);

  /** @type {Record<WeatherKind, { enter: () => void, tick: (dt: number, camPos: {x:number,y:number,z:number}) => void, exit: () => void }>} */
  const kinds = {
    clear: {
      enter() {
        rain.setVisible(false);
        timeOfDay.setOvercast(0);
      },
      tick() {},
      exit() {},
    },
    rain: {
      enter() {
        rain.setVisible(true);
        timeOfDay.setOvercast(1);
      },
      tick(dt, camPos) {
        rain.update(dt, camPos);
      },
      exit() {
        rain.setVisible(false);
      },
    },
  };

  /** @type {WeatherKind} */
  let current = 'clear';
  kinds[current].enter();

  /**
   * @param {number} dt
   * @param {{ x: number, y: number, z: number }} camPos
   */
  function update(dt, camPos) {
    kinds[current].tick(dt, camPos);
  }

  /** @param {WeatherKind} kind */
  function set(kind) {
    if (!(kind in kinds) || kind === current) return;
    kinds[current].exit();
    current = kind;
    kinds[current].enter();
  }

  /** @param {1 | -1} [dir] */
  function cycle(dir = 1) {
    const i = WEATHER_KINDS.indexOf(current);
    const next = (i + dir + WEATHER_KINDS.length) % WEATHER_KINDS.length;
    set(WEATHER_KINDS[next]);
  }

  return {
    update,
    set,
    cycle,
    getCurrent: () => current,
  };
}

/** @typedef {ReturnType<typeof createWeather>} Weather */
