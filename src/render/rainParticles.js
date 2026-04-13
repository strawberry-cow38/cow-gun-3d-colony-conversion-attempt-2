/**
 * Rain: a Points cloud that follows the camera horizontally and recycles
 * particles from ground back to max height. Cheap enough that a flat 2000
 * droplets gives the illusion of rain out to the view distance without any
 * per-frame allocations.
 *
 * Kept intentionally renderer-only: the weather module (src/world/weather.js)
 * decides when to show/hide it and drives the tint on the sky/lights.
 */

import * as THREE from 'three';
import { UNITS_PER_METER } from '../world/coords.js';

const COUNT = 2000;
const AREA = 60 * UNITS_PER_METER; // patch width around the camera
const HEIGHT = 40 * UNITS_PER_METER;
const FALL_SPEED = 35 * UNITS_PER_METER; // units per second
const DROPLET_SIZE = 0.08 * UNITS_PER_METER;

/**
 * @param {THREE.Scene} scene
 */
export function createRainParticles(scene) {
  const positions = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * AREA;
    positions[i * 3 + 1] = Math.random() * HEIGHT;
    positions[i * 3 + 2] = (Math.random() - 0.5) * AREA;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xaac8ea,
    size: DROPLET_SIZE,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);

  /**
   * @param {number} dt
   * @param {{ x: number, y: number, z: number }} camPos
   */
  function update(dt, camPos) {
    points.position.set(camPos.x, 0, camPos.z);
    const arr = /** @type {Float32Array} */ (geo.attributes.position.array);
    const drop = FALL_SPEED * dt;
    for (let i = 0; i < COUNT; i++) {
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

  /** @param {boolean} v */
  function setVisible(v) {
    points.visible = v;
  }

  return { update, setVisible };
}

/** @typedef {ReturnType<typeof createRainParticles>} RainParticles */
