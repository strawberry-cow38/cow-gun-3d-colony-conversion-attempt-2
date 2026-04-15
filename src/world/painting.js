/**
 * Procedural painting generator. Each painting gets a title, a color palette,
 * and a list of simple 2D shapes, all deterministic from a seed. Rendered as
 * a flat quad with a baked-off canvas texture by the painting instancer.
 *
 * Titles combine an adjective + a noun, with a 30% chance of a trailing
 * roman numeral for variety ("The Restless Pasture II"). Quality is a
 * framework field — always 'normal' today, wired so future systems can
 * upgrade it without migrating data.
 */

const ADJECTIVES = [
  'Restless', 'Silent', 'Wandering', 'Drowsy', 'Forgotten',
  'Weeping', 'Placid', 'Luminous', 'Brooding', 'Serene',
  'Tempestuous', 'Golden', 'Cobalt', 'Crimson', 'Velvet',
  'Lonely', 'Haunted', 'Eternal', 'Autumnal', 'Hollow',
  'Fractured', 'Gentle', 'Sovereign', 'Forlorn', 'Tender',
];

const NOUNS = [
  'Pasture', 'Cow', 'Meadow', 'Hearth', 'Moon',
  'Horizon', 'Harvest', 'Thicket', 'Orchard', 'Bell',
  'Silence', 'Dawn', 'Dusk', 'Vigil', 'Procession',
  'Wanderer', 'Echo', 'Lantern', 'Garden', 'Furrow',
  'Herd', 'Stream', 'Storm', 'Keeper', 'Memory',
];

const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/** @type {string[][]} Six hand-picked palettes, each 4 colors. */
const PALETTES = [
  ['#2b1a0e', '#7a4a1e', '#d8b26a', '#f4e4b8'], // warm wood
  ['#0a1830', '#1f4a78', '#6ea3d8', '#e8ecf4'], // cobalt sky
  ['#1a0e1e', '#5a2a4a', '#b84a6a', '#f0d0c0'], // plum dusk
  ['#0e2018', '#2a5a3a', '#8abf6a', '#f2f0c8'], // meadow
  ['#1a1210', '#4a2a2a', '#a05030', '#e8b070'], // clay
  ['#0a0a18', '#2a1a3a', '#6050a0', '#c8b0f0'], // twilight
];

/** @param {number} seed */
function rngFrom(seed) {
  let s = seed >>> 0;
  if (s === 0) s = 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

/**
 * Build a procedural painting spec from a seed. Deterministic: same seed →
 * same title, palette, and shapes, so reload and visual rendering stay
 * stable across saves.
 *
 * @param {number} seed  typically `tick * 1000 + artistCowId`
 * @param {number} size  1..4 tiles
 * @returns {{
 *   title: string,
 *   palette: string[],
 *   shapes: { type: string, x: number, y: number, w: number, h: number, color: number }[],
 * }}
 */
export function generatePainting(seed, size) {
  const rng = rngFrom(seed);
  const adj = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(rng() * NOUNS.length)];
  const tail = rng() < 0.3 ? ` ${ROMAN[Math.floor(rng() * ROMAN.length)]}` : '';
  const title = `The ${adj} ${noun}${tail}`;

  const palette = PALETTES[Math.floor(rng() * PALETTES.length)].slice();

  // Shape count scales with size: small has ~6, huge has ~18.
  const count = 4 + Math.floor(size * 3 + rng() * 3);
  /** @type {{ type: string, x: number, y: number, w: number, h: number, color: number }[]} */
  const shapes = [];
  const types = ['rect', 'circle', 'triangle'];
  for (let k = 0; k < count; k++) {
    const type = types[Math.floor(rng() * types.length)];
    const w = 0.1 + rng() * 0.6;
    const h = 0.1 + rng() * 0.6;
    const x = rng() * (1 - w);
    const y = rng() * (1 - h);
    // Bias toward later-in-palette (warmer/brighter) colors near the top of
    // the z-order so highlights sit on shadowed ground tones underneath.
    const colorIdx = Math.min(palette.length - 1, Math.floor(rng() * palette.length));
    shapes.push({ type, x, y, w, h, color: colorIdx });
  }
  return { title, palette, shapes };
}
