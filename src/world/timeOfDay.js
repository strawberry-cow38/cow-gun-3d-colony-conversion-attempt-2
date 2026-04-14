/**
 * Day-night cycle. Normalized time t ∈ [0, 1) where 0 = midnight, 0.25 =
 * sunrise, 0.5 = noon, 0.75 = sunset. Modulates the directional sun,
 * hemisphere fill, and sky shader uniforms from four keyframe palettes.
 *
 * Palettes are wired in the order sky→hemi→sun→shader-uniforms; weather
 * modules (src/world/weather.js) tweak the resulting intensities via
 * `setOverrideTint` instead of owning their own lights.
 */

import * as THREE from 'three';

// 24 real minutes per sim day — slow enough to feel natural but short enough
// that a session sees multiple dawns. Debug T/Shift+T scrubs if you're
// hunting a specific palette.
export const DAY_LENGTH_SEC = 1440;
export const HOURS_PER_DAY = 24;

const SKY_UNIFORM_KEYS = /** @type {const} */ ([
  'zenithColor',
  'upperSkyColor',
  'horizonGlow',
  'horizonLow',
  'groundColor',
  'cloudWarm',
  'cloudCool',
  'cloudDark',
]);

/**
 * @typedef {{
 *   sunColor: number, sunIntensity: number,
 *   hemiSky: number, hemiGround: number, hemiIntensity: number,
 *   zenithColor: number, upperSkyColor: number,
 *   horizonGlow: number, horizonLow: number, groundColor: number,
 *   cloudWarm: number, cloudCool: number, cloudDark: number,
 * }} Palette
 */

// Four keyframes around the day. `timeOfDay` linearly interpolates between
// them by t — values between keyframes ease naturally because the sun-angle
// math is separate from palette lerp.
/** @type {Record<'midnight'|'sunrise'|'noon'|'sunset', Palette>} */
const PALETTES = {
  midnight: {
    sunColor: 0x6a7ab8,
    sunIntensity: 0.12,
    hemiSky: 0x1a2850,
    hemiGround: 0x05060f,
    hemiIntensity: 0.22,
    zenithColor: 0x05060f,
    upperSkyColor: 0x1a1838,
    horizonGlow: 0x2a3f78,
    horizonLow: 0x1a2850,
    groundColor: 0x030308,
    cloudWarm: 0x4a5a8a,
    cloudCool: 0x1f2a48,
    cloudDark: 0x080818,
  },
  sunrise: {
    sunColor: 0xffa66a,
    sunIntensity: 0.85,
    hemiSky: 0xffb27a,
    hemiGround: 0x2a1a3a,
    hemiIntensity: 0.55,
    zenithColor: 0x2a1838,
    upperSkyColor: 0x4d2a58,
    horizonGlow: 0xffa267,
    horizonLow: 0xff7a3a,
    groundColor: 0x1a0e26,
    cloudWarm: 0xffd0a0,
    cloudCool: 0x6a3a78,
    cloudDark: 0x2c1840,
  },
  noon: {
    sunColor: 0xfff4d6,
    sunIntensity: 1.15,
    hemiSky: 0x7fb8e8,
    hemiGround: 0x2a3a2a,
    hemiIntensity: 0.75,
    zenithColor: 0x1a5a9a,
    upperSkyColor: 0x60a0d8,
    horizonGlow: 0xcce8ff,
    horizonLow: 0x8fc0e8,
    groundColor: 0x2a3a4a,
    cloudWarm: 0xffffff,
    cloudCool: 0x9ab5cc,
    cloudDark: 0x4a6080,
  },
  sunset: {
    sunColor: 0xffb46b,
    sunIntensity: 0.9,
    hemiSky: 0xffb27a,
    hemiGround: 0x2a1a3a,
    hemiIntensity: 0.6,
    zenithColor: 0x2a1838,
    upperSkyColor: 0x4d2a58,
    horizonGlow: 0xffa267,
    horizonLow: 0xff7a3a,
    groundColor: 0x1a0e26,
    cloudWarm: 0xffd0a0,
    cloudCool: 0x6a3a78,
    cloudDark: 0x2c1840,
  },
};

const KEYFRAMES = /** @type {const} */ ([
  { t: 0.0, palette: PALETTES.midnight },
  { t: 0.25, palette: PALETTES.sunrise },
  { t: 0.5, palette: PALETTES.noon },
  { t: 0.75, palette: PALETTES.sunset },
  { t: 1.0, palette: PALETTES.midnight },
]);

/**
 * @param {number} t
 * @returns {Palette}
 */
function sample(t) {
  const wrapped = ((t % 1) + 1) % 1;
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i];
    const b = KEYFRAMES[i + 1];
    if (wrapped >= a.t && wrapped <= b.t) {
      const u = (wrapped - a.t) / (b.t - a.t);
      return lerpPalette(a.palette, b.palette, u);
    }
  }
  return KEYFRAMES[0].palette;
}

/**
 * @param {Palette} a @param {Palette} b @param {number} u
 * @returns {Palette}
 */
function lerpPalette(a, b, u) {
  const colorKeys = /** @type {(keyof Palette)[]} */ ([
    'sunColor',
    'hemiSky',
    'hemiGround',
    'zenithColor',
    'upperSkyColor',
    'horizonGlow',
    'horizonLow',
    'groundColor',
    'cloudWarm',
    'cloudCool',
    'cloudDark',
  ]);
  const result = /** @type {Palette} */ ({ ...a });
  for (const k of colorKeys) {
    result[k] = lerpHex(/** @type {number} */ (a[k]), /** @type {number} */ (b[k]), u);
  }
  result.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * u;
  result.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * u;
  return result;
}

/**
 * @param {number} a @param {number} b @param {number} u
 */
function lerpHex(a, b, u) {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * u) & 0xff;
  const g = Math.round(ag + (bg - ag) * u) & 0xff;
  const bl = Math.round(ab + (bb - ab) * u) & 0xff;
  return (r << 16) | (g << 8) | bl;
}

/**
 * @param {{
 *   sun: THREE.DirectionalLight,
 *   hemi: THREE.HemisphereLight,
 *   sky: THREE.Mesh,
 *   initialT?: number,
 * }} opts
 */
export function createTimeOfDay(opts) {
  const { sun, hemi, sky } = opts;
  const skyMat = /** @type {THREE.ShaderMaterial} */ (sky.material);
  let t = opts.initialT ?? 0.7; // open in early-evening to preserve existing look

  // Rain/overcast desaturates + dims by lerping the live palette toward gray.
  // `setOverrideTint(1)` = full overcast; 0 = clear. Applied post-sample so
  // weather layers compose cleanly with whatever time produces.
  let overcast = 0;

  const _sunVec = new THREE.Vector3();

  function apply() {
    const p = sample(t);

    const sunY = Math.sin((t - 0.25) * Math.PI * 2);
    const sunZ = Math.cos((t - 0.25) * Math.PI * 2);
    _sunVec.set(0.35, sunY, sunZ).normalize().multiplyScalar(4000);
    sun.position.copy(_sunVec);

    const dim = 1 - overcast * 0.45;
    sun.color.setHex(p.sunColor);
    sun.intensity = p.sunIntensity * dim;
    hemi.color.setHex(p.hemiSky);
    hemi.groundColor.setHex(p.hemiGround);
    hemi.intensity = p.hemiIntensity * dim;

    for (const key of SKY_UNIFORM_KEYS) {
      const c = /** @type {THREE.Color} */ (skyMat.uniforms[key].value);
      c.setHex(/** @type {number} */ (p[key]));
      if (overcast > 0) {
        // Shift sky toward a flat gray-blue so rain reads as overcast.
        const OVERCAST_GRAY = 0x47506b;
        const gr = ((OVERCAST_GRAY >> 16) & 0xff) / 255;
        const gg = ((OVERCAST_GRAY >> 8) & 0xff) / 255;
        const gb = (OVERCAST_GRAY & 0xff) / 255;
        c.r += (gr - c.r) * overcast * 0.5;
        c.g += (gg - c.g) * overcast * 0.5;
        c.b += (gb - c.b) * overcast * 0.5;
      }
    }
  }

  /** @param {number} dtSec */
  function update(dtSec) {
    t = (t + dtSec / DAY_LENGTH_SEC) % 1;
    apply();
  }

  /** @param {number} hours */
  function offsetHours(hours) {
    t = (((t + hours / HOURS_PER_DAY) % 1) + 1) % 1;
    apply();
  }

  /** @param {number} v 0 = clear, 1 = full overcast */
  function setOvercast(v) {
    overcast = Math.max(0, Math.min(1, v));
    apply();
  }

  // 6am-6pm full sun, 6pm-9pm fade, 9pm-5am dark, 5am-6am rise. t=0.25 is 6am,
  // t=0.75 is 6pm, t=0.875 is 9pm, t≈0.208 is 5am.
  function getSunLightPercent() {
    if (t >= 0.25 && t <= 0.75) return 1;
    if (t > 0.75 && t < 0.875) return 1 - (t - 0.75) / 0.125;
    if (t > 5 / 24 && t < 0.25) return (t - 5 / 24) / (0.25 - 5 / 24);
    return 0;
  }

  function getHHMM() {
    const totalMinutes = Math.floor(t * HOURS_PER_DAY * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  apply();
  return {
    update,
    offsetHours,
    setOvercast,
    getHHMM,
    getSunLightPercent,
    getT: () => t,
  };
}

/** @typedef {ReturnType<typeof createTimeOfDay>} TimeOfDay */
