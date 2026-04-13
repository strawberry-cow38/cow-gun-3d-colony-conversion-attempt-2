/**
 * Rain: a Points cloud that follows the camera horizontally and recycles
 * particles from ground back to max height. Cheap enough that a flat 4000
 * droplets gives the illusion of rain out to the view distance without any
 * per-frame allocations.
 *
 * Two knobs:
 *   - `targetAlpha` 0..1   — overall opacity multiplier; lerped each frame so
 *                            weather start/stop fades in and out smoothly
 *                            instead of popping.
 *   - `targetIntensity` 0..1 — fraction of MAX_COUNT droplets that are
 *                            actually drawn (via geometry draw-range). Storm
 *                            cranks this to 1.0; plain rain to 0.5.
 *
 * Kept intentionally renderer-only: the weather module (src/world/weather.js)
 * decides when to show/hide it and drives the tint on the sky/lights.
 */

import * as THREE from 'three';
import { UNITS_PER_METER } from '../world/coords.js';

const MAX_COUNT = 4000;
const AREA = 60 * UNITS_PER_METER; // patch width around the camera
const HEIGHT = 40 * UNITS_PER_METER;
const FALL_SPEED = 35 * UNITS_PER_METER; // units per second
const DROPLET_SIZE = 0.08 * UNITS_PER_METER;
const PEAK_OPACITY = 0.55;

/**
 * @param {THREE.Scene} scene
 */
export function createRainParticles(scene) {
  const positions = new Float32Array(MAX_COUNT * 3);
  for (let i = 0; i < MAX_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * AREA;
    positions[i * 3 + 1] = Math.random() * HEIGHT;
    positions[i * 3 + 2] = (Math.random() - 0.5) * AREA;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({
    color: 0xaac8ea,
    size: DROPLET_SIZE,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);

  // Live + target alpha/intensity. We lerp both per frame at `fadeRate` so a
  // weather change feels like a smooth ramp-up rather than a pop.
  let alpha = 0;
  let targetAlpha = 0;
  let intensity = 0;
  let targetIntensity = 0;
  // 1 / seconds — α=2 ≈ 1.5s to get from 0 to 0.95 of target. Slow enough to
  // read as "rain rolling in", fast enough not to look broken.
  let fadeRate = 2;

  /**
   * @param {number} dt
   * @param {{ x: number, y: number, z: number }} camPos
   */
  function update(dt, camPos) {
    // Tween live values toward targets. Frame-rate-independent exponential
    // approach so a 30fps and 144fps client get the same perceived fade.
    const k = 1 - Math.exp(-fadeRate * dt);
    alpha += (targetAlpha - alpha) * k;
    intensity += (targetIntensity - intensity) * k;

    if (alpha < 0.001 && targetAlpha === 0) {
      points.visible = false;
      mat.opacity = 0;
      geo.setDrawRange(0, 0);
      return;
    }
    points.visible = true;
    mat.opacity = alpha * PEAK_OPACITY;
    const activeCount = Math.max(0, Math.min(MAX_COUNT, Math.round(intensity * MAX_COUNT)));
    geo.setDrawRange(0, activeCount);

    points.position.set(camPos.x, 0, camPos.z);
    const arr = /** @type {Float32Array} */ (geo.attributes.position.array);
    const drop = FALL_SPEED * dt;
    for (let i = 0; i < activeCount; i++) {
      const iy = i * 3 + 1;
      arr[iy] -= drop;
      if (arr[iy] < 0) {
        arr[iy] = HEIGHT;
        arr[i * 3] = (Math.random() - 0.5) * AREA;
        arr[i * 3 + 2] = (Math.random() - 0.5) * AREA;
      }
    }
    geo.attributes.position.needsUpdate = true;
  }

  /**
   * Begin (or update) the rain effect. Fades up to `intensity` over time at
   * the current `fadeRate`. Idempotent — calling repeatedly with new args
   * just retargets the lerp.
   *
   * @param {number} [intensityTarget] 0..1 — fraction of MAX_COUNT droplets to draw
   * @param {number} [secondsToFull]   how long to ramp 0 → target visually
   */
  function show(intensityTarget = 0.5, secondsToFull = 1.5) {
    targetAlpha = 1;
    targetIntensity = Math.max(0, Math.min(1, intensityTarget));
    fadeRate = 3 / Math.max(0.1, secondsToFull); // exp constant: 3τ ≈ 95% to target
  }

  /**
   * Begin the fade-out. Particles keep falling but gradually invisible, then
   * the mesh hides itself once alpha crosses zero.
   *
   * @param {number} [secondsToZero]
   */
  function hide(secondsToZero = 1.5) {
    targetAlpha = 0;
    targetIntensity = 0;
    fadeRate = 3 / Math.max(0.1, secondsToZero);
  }

  /** @param {boolean} v  legacy show/hide without fade — kept for callers that just want it gone. */
  function setVisible(v) {
    if (v) show();
    else hide();
  }

  return { update, setVisible, show, hide };
}

/** @typedef {ReturnType<typeof createRainParticles>} RainParticles */
