/**
 * Lightning + thunder scheduler.
 *
 * Owns two bits of state:
 *   - `flashLevel` 0..1, decayed exponentially each frame. We add it on top of
 *     sun + hemi intensity AFTER time-of-day has written them, so the boost
 *     lands every frame without TimeOfDay needing to know about weather.
 *   - `pendingThunder` seconds of delay between the visual flash and the
 *     audio clap — simulates the "light arrives first" physics and keeps
 *     every strike from sounding like a drum-machine hit.
 *
 * `trigger()` is idempotent-ish: a second trigger during an active flash just
 * restarts the decay (bright on top of bright is indistinguishable from
 * another strike for our purposes).
 */

/**
 * @param {{
 *   sun: import('three').DirectionalLight,
 *   hemi: import('three').HemisphereLight,
 *   audio?: { play: (kind: string) => void },
 * }} opts
 */
export function createLightning({ sun, hemi, audio }) {
  let flashLevel = 0;
  let pendingThunder = -1;
  // The numbers here are balanced against the TimeOfDay sun.intensity of
  // ~0.1..1.15. A flashLevel=1 bump of +1.8 to sun means the scene really
  // does feel like daylight for a frame before decaying.
  const SUN_BOOST = 1.8;
  const HEMI_BOOST = 1.0;
  const FLASH_DECAY = 5; // 1/s — τ ≈ 0.2s, so flash fully gone in ~0.8s

  function trigger() {
    flashLevel = 0.85 + Math.random() * 0.5;
    // Thunder arrives 0.4–2.5s after the flash depending on "distance".
    pendingThunder = 0.4 + Math.random() * 2.1;
  }

  /** @param {number} dt */
  function update(dt) {
    if (flashLevel > 0) {
      // Exp decay toward 0 — frame-rate independent.
      flashLevel *= Math.exp(-FLASH_DECAY * dt);
      if (flashLevel < 0.001) flashLevel = 0;
      sun.intensity += flashLevel * SUN_BOOST;
      hemi.intensity += flashLevel * HEMI_BOOST;
    }
    if (pendingThunder > 0) {
      pendingThunder -= dt;
      if (pendingThunder <= 0) {
        audio?.play('thunder');
        pendingThunder = -1;
      }
    }
  }

  return { trigger, update, getFlashLevel: () => flashLevel };
}

/** @typedef {ReturnType<typeof createLightning>} Lightning */
