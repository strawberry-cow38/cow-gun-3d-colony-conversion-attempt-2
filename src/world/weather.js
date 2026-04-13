/**
 * Weather state machine + registry.
 *
 * Each kind implements `{ enter(), tick(dt, camPos), exit() }`. Adding a new
 * weather (snow, fog, …) is a one-entry-per-kind addition here plus any
 * renderer it needs — no changes to main.js or the HUD beyond an optional
 * label.
 *
 * Weather tweaks time-of-day via `setOvercast` rather than owning its own
 * lights, so rain during dawn still reads as "dim sunrise" instead of
 * stomping on the palette. Thunderstorm additionally piggybacks on the
 * Lightning module to pulse sun + hemi for flashes; those writes happen
 * AFTER time-of-day in the render loop so the boost survives exactly one
 * frame and decays naturally.
 */

import { createLightning } from '../render/lightning.js';
import { createRainParticles } from '../render/rainParticles.js';

export const WEATHER_KINDS = /** @type {const} */ (['clear', 'rain', 'storm']);

/** @typedef {(typeof WEATHER_KINDS)[number]} WeatherKind */

/**
 * @param {{
 *   scene: import('three').Scene,
 *   timeOfDay: import('./timeOfDay.js').TimeOfDay,
 *   sun: import('three').DirectionalLight,
 *   hemi: import('three').HemisphereLight,
 *   audio?: {
 *     startLoop: (kind: string) => void,
 *     stopLoop: (kind: string) => void,
 *     play: (kind: string) => void,
 *   },
 * }} opts
 */
export function createWeather(opts) {
  const { scene, timeOfDay, sun, hemi, audio } = opts;
  const rain = createRainParticles(scene);
  const lightning = createLightning({ sun, hemi, audio });

  // Storm lightning scheduler state. `nextFlashIn` only counts down while
  // storm is the active kind; resetting it on enter guarantees a fresh
  // interval each time the player cycles through.
  let nextFlashIn = 0;

  /** @type {Record<WeatherKind, { enter: () => void, tick: (dt: number, camPos: {x:number,y:number,z:number}) => void, exit: () => void }>} */
  const kinds = {
    clear: {
      enter() {
        rain.hide(1.5);
        timeOfDay.setOvercast(0);
      },
      tick(dt, camPos) {
        // Keep ticking the rain renderer so in-flight fade-outs finish cleanly
        // after a rain→clear transition; once alpha hits zero it self-hides.
        rain.update(dt, camPos);
      },
      exit() {},
    },
    rain: {
      enter() {
        rain.show(0.5, 1.8);
        timeOfDay.setOvercast(1);
        audio?.startLoop('rain');
      },
      tick(dt, camPos) {
        rain.update(dt, camPos);
      },
      exit() {
        rain.hide(2.0);
        audio?.stopLoop('rain');
      },
    },
    storm: {
      enter() {
        // Double the intensity of plain rain (1.0 vs 0.5) — same MAX_COUNT
        // buffer so there's no reallocation, we just draw twice as many
        // droplets via setDrawRange.
        rain.show(1.0, 3.0);
        timeOfDay.setOvercast(1);
        audio?.startLoop('storm');
        // First flash lands 3–8s after entry so the player notices the storm
        // kick in before sky stays overcast-dim.
        nextFlashIn = 3 + Math.random() * 5;
      },
      tick(dt, camPos) {
        rain.update(dt, camPos);
        lightning.update(dt);
        nextFlashIn -= dt;
        if (nextFlashIn <= 0) {
          lightning.trigger();
          // 6–18s between strikes — varied enough that the pattern doesn't
          // read as a metronome, frequent enough to feel like a real storm.
          nextFlashIn = 6 + Math.random() * 12;
        }
      },
      exit() {
        rain.hide(2.5);
        audio?.stopLoop('storm');
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
