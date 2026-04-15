/**
 * Per-glyph handwriting jitter. Every colonist gets stable (seeded) noise
 * applied to each letter of their name so no two cows have the same hand
 * even when they share a base font. Seed is (cow id, letter index) so the
 * same cow always writes their name the same way, but a different cow
 * writing the same letters looks different.
 *
 * Used by the canvas-based 3D name tags and by per-letter HTML spans in the
 * info card + portrait bar.
 */

const SALT_OFFSET_Y = 0x9e3779b1;
const SALT_SCALE_X = 0x85ebca6b;
const SALT_ROTATE = 0xc2b2ae35;

/** Mulberry32 step: 32-bit state → 32-bit pseudo-random uint. */
function mulberry32(state) {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** @param {number} cowId @param {number} letterIdx @param {number} salt */
function rand01(cowId, letterIdx, salt) {
  // Blend the three ints into a single seed before stepping — cheap and
  // avoids correlation between axes (e.g. tall letters also slanting the
  // same way).
  const seed = (cowId * 2654435761 + letterIdx * 40503 + salt) | 0;
  return mulberry32(seed) / 0x100000000;
}

/**
 * @typedef GlyphJitter
 * @property {number} offsetYEm   vertical offset as a fraction of em-height (±0.042 = ±3px at 72px)
 * @property {number} scaleX      horizontal stretch, 0.92..1.08
 * @property {number} rotDeg      rotation, ±4°
 */

/**
 * @param {number} cowId
 * @param {number} letterIdx
 * @returns {GlyphJitter}
 */
export function jitterForGlyph(cowId, letterIdx) {
  const y = rand01(cowId, letterIdx, SALT_OFFSET_Y) * 2 - 1;
  const s = rand01(cowId, letterIdx, SALT_SCALE_X) * 2 - 1;
  const r = rand01(cowId, letterIdx, SALT_ROTATE) * 2 - 1;
  return {
    offsetYEm: y * 0.042,
    scaleX: 1 + s * 0.08,
    rotDeg: r * 4,
  };
}

/**
 * Render a name into a container element as per-letter inline-block spans
 * with jitter transforms. Clears existing children.
 *
 * @param {HTMLElement} el
 * @param {number} cowId
 * @param {string} name
 */
export function writeJitteredName(el, cowId, name) {
  el.replaceChildren();
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    const span = document.createElement('span');
    span.textContent = ch === ' ' ? '\u00a0' : ch;
    span.style.display = 'inline-block';
    const j = jitterForGlyph(cowId, i);
    span.style.transform = `translateY(${j.offsetYEm.toFixed(3)}em) rotate(${j.rotDeg.toFixed(2)}deg) scaleX(${j.scaleX.toFixed(3)})`;
    el.appendChild(span);
  }
}
