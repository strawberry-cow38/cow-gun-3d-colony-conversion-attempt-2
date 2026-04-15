/**
 * Drive the correct time-of-day ambient loop (dawn/day/dusk/night) based on
 * the shared `timeOfDay` module's normalized `t`. One loop plays at a time;
 * transitions crossfade via the audio engine's own fade-in / fade-out.
 *
 * Boundaries match the sun-light curve in `timeOfDay.js`:
 *   - night: t < 0.208   (midnight–5am) or t >= 0.875 (9pm–midnight)
 *   - dawn:  0.208 ≤ t < 0.25   (5am–6am)
 *   - day:   0.25  ≤ t < 0.75   (6am–6pm)
 *   - dusk:  0.75  ≤ t < 0.875  (6pm–9pm)
 */

const LOOPS = /** @type {const} */ ({
  dawn: 'ambient_dawn',
  day: 'ambient_day',
  dusk: 'ambient_dusk',
  night: 'ambient_night',
});

/** @param {number} t normalized time-of-day in [0, 1) */
function phaseForT(t) {
  if (t < 0.208) return 'night';
  if (t < 0.25) return 'dawn';
  if (t < 0.75) return 'day';
  if (t < 0.875) return 'dusk';
  return 'night';
}

/**
 * @param {{
 *   audio: { startLoop: (kind: string) => void, stopLoop: (kind: string) => void },
 *   timeOfDay: { getT: () => number },
 * }} opts
 */
export function createAmbientScheduler({ audio, timeOfDay }) {
  /** @type {keyof typeof LOOPS | null} */
  let current = null;

  function update() {
    const next = phaseForT(timeOfDay.getT());
    if (next === current) return;
    if (current) audio.stopLoop(LOOPS[current]);
    audio.startLoop(LOOPS[next]);
    current = next;
  }

  return { update };
}
