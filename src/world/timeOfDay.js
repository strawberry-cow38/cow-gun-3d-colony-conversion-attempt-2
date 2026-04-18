/**
 * Day-night cycle. Normalized time t ∈ [0, 1) where 0 = midnight, 0.25 =
 * sunrise, 0.5 = noon, 0.75 = sunset. Modulates the directional sun,
 * hemisphere fill, and sky shader uniforms from four keyframe palettes.
 *
 * t is driven by the sim tick via `setT` — caller computes the fraction from
 * the calendar so speed multipliers accelerate the sun alongside everything
 * else. Weather (src/world/weather.js) tweaks intensities via `setOvercast`
 * instead of owning its own lights.
 */

import * as THREE from 'three';

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
    sunColor: 0x8aa4f0,
    sunIntensity: 0.18,
    hemiSky: 0x2a1f60,
    hemiGround: 0x06081a,
    hemiIntensity: 0.32,
    zenithColor: 0x06081e,
    upperSkyColor: 0x2a1058,
    horizonGlow: 0x6a3aa0,
    horizonLow: 0x4a2880,
    groundColor: 0x040312,
    cloudWarm: 0x8a6acc,
    cloudCool: 0x2a1858,
    cloudDark: 0x06061a,
  },
  sunrise: {
    sunColor: 0xff9eb8,
    sunIntensity: 0.95,
    hemiSky: 0xff9ec0,
    hemiGround: 0x4a1a58,
    hemiIntensity: 0.65,
    zenithColor: 0x3a1858,
    upperSkyColor: 0x7a2a8a,
    horizonGlow: 0xff7ac0,
    horizonLow: 0xff5a90,
    groundColor: 0x2a0e3a,
    cloudWarm: 0xffc0e0,
    cloudCool: 0x8a3aa8,
    cloudDark: 0x3c1858,
  },
  noon: {
    sunColor: 0xfff4d6,
    sunIntensity: 1.25,
    hemiSky: 0x7ad6f0,
    hemiGround: 0x2a4a3a,
    hemiIntensity: 0.85,
    zenithColor: 0x2070d8,
    upperSkyColor: 0x6ac0f0,
    horizonGlow: 0xd8f4ff,
    horizonLow: 0x9ad8f8,
    groundColor: 0x2a4a5a,
    cloudWarm: 0xffffff,
    cloudCool: 0x9ad0e8,
    cloudDark: 0x4a708a,
  },
  sunset: {
    sunColor: 0xff7050,
    sunIntensity: 1.0,
    hemiSky: 0xff90a8,
    hemiGround: 0x3a1a58,
    hemiIntensity: 0.7,
    zenithColor: 0x3a1858,
    upperSkyColor: 0x6a2090,
    horizonGlow: 0xff70a0,
    horizonLow: 0xff5060,
    groundColor: 0x2a0e3a,
    cloudWarm: 0xffb070,
    cloudCool: 0x7a3aa0,
    cloudDark: 0x2c1850,
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
 *   sunDisc?: THREE.Mesh,
 *   moonDisc?: THREE.Mesh,
 *   camera?: THREE.Camera,
 *   scene?: THREE.Scene,
 *   initialT?: number,
 * }} opts
 */
export function createTimeOfDay(opts) {
  const { sun, hemi, sky, sunDisc, moonDisc, camera, scene } = opts;
  const skyMat = /** @type {THREE.ShaderMaterial} */ (sky.material);
  let t = opts.initialT ?? 0.7; // open in early-evening to preserve existing look

  // Rain/overcast desaturates + dims by lerping the live palette toward gray.
  // `setOverrideTint(1)` = full overcast; 0 = clear. Applied post-sample so
  // weather layers compose cleanly with whatever time produces.
  let overcast = 0;

  const _sunVec = new THREE.Vector3();
  const _origin = new THREE.Vector3();
  // Place celestial discs near the sky shell so they read as far away. Sky
  // sphere is 40000 — 35000 keeps them clearly inside the dome without
  // clipping when the camera pans.
  const SKY_RADIUS = 35000;

  function apply() {
    const p = sample(t);

    const sunY = Math.sin((t - 0.25) * Math.PI * 2);
    const sunZ = Math.cos((t - 0.25) * Math.PI * 2);
    _sunVec.set(0.35, sunY, sunZ).normalize().multiplyScalar(4000);
    sun.position.copy(_sunVec);

    if (sunDisc) {
      const dir = _sunVec.clone().normalize();
      // Anchor to the camera so the disc sits at a fixed sky angle from the
      // viewer instead of parallaxing past the world-origin offset. That
      // angle is the same one the directional light uses, so the visible
      // sun matches the shadow direction frame-to-frame.
      const anchor = camera ? camera.position : _origin;
      sunDisc.position.copy(anchor).addScaledVector(dir, SKY_RADIUS);
      /** @type {THREE.MeshBasicMaterial} */ (sunDisc.material).color.setHex(p.sunColor);
      sunDisc.visible = dir.y > -0.05;
    }
    if (moonDisc) {
      const dir = _sunVec.clone().normalize();
      const anchor = camera ? camera.position : _origin;
      moonDisc.position.copy(anchor).addScaledVector(dir, -SKY_RADIUS);
      moonDisc.visible = -dir.y > -0.05;
    }

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

    if (scene?.fog && 'color' in scene.fog) {
      // Fog tracks the horizon glow so distant geometry blends into the sky.
      // Slightly darker mix keeps midground from looking blown out at noon.
      const fogColor = /** @type {THREE.Color} */ (scene.fog.color);
      fogColor.setHex(p.horizonGlow).multiplyScalar(0.85);
      if (overcast > 0) fogColor.lerp(new THREE.Color(0x47506b), overcast * 0.5);
    }
  }

  /** @param {number} nextT normalized day fraction 0..1 */
  function setT(nextT) {
    t = ((nextT % 1) + 1) % 1;
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
    setT,
    setOvercast,
    getHHMM,
    getSunLightPercent,
    getT: () => t,
  };
}

/** @typedef {ReturnType<typeof createTimeOfDay>} TimeOfDay */
