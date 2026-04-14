/**
 * Roof-collapse dust: a shared Points cloud with a ring-buffer pool. Each
 * `burst(x, y, z)` grabs PARTICLES_PER_BURST slots, seeds them at the roof
 * position with outward-and-up splash velocities, then gravity pulls them
 * back down until their life runs out and they park off-screen.
 *
 * One material, one draw call — works the same way as rainParticles but
 * event-driven instead of continuous.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER } from '../world/coords.js';

const MAX_PARTICLES = 600;
const PARTICLES_PER_BURST = 28;
const LIFE = 1.1;
const GRAVITY = 22 * UNITS_PER_METER;
const SPAWN_SPREAD = TILE_SIZE * 0.35;
const INITIAL_VEL_XZ = 2.0 * UNITS_PER_METER;
const INITIAL_VEL_Y = 2.4 * UNITS_PER_METER;
// Expired particles get parked here so the Points draw skips them visually
// without the cost of rebuilding the draw-range per frame.
const OFFSCREEN_Y = -1e6;

/**
 * @param {THREE.Scene} scene
 */
export function createRoofCollapseParticles(scene) {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const ages = new Float32Array(MAX_PARTICLES);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    positions[i * 3 + 1] = OFFSCREEN_Y;
    ages[i] = -1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xb89872,
    size: 0.22 * UNITS_PER_METER,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let cursor = 0;
  let liveCount = 0;

  /** @param {number} x @param {number} y @param {number} z */
  function burst(x, y, z) {
    for (let n = 0; n < PARTICLES_PER_BURST; n++) {
      const i = cursor;
      cursor = (cursor + 1) % MAX_PARTICLES;
      if (ages[i] < 0) liveCount++;
      positions[i * 3] = x + (Math.random() - 0.5) * SPAWN_SPREAD;
      positions[i * 3 + 1] = y + (Math.random() - 0.5) * SPAWN_SPREAD * 0.25;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * SPAWN_SPREAD;
      const ang = Math.random() * Math.PI * 2;
      const mag = Math.random() * INITIAL_VEL_XZ;
      velocities[i * 3] = Math.cos(ang) * mag;
      velocities[i * 3 + 1] = Math.random() * INITIAL_VEL_Y;
      velocities[i * 3 + 2] = Math.sin(ang) * mag;
      ages[i] = 0;
    }
    geo.attributes.position.needsUpdate = true;
  }

  /** @param {number} dt */
  function update(dt) {
    if (liveCount === 0) return;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (ages[i] < 0) continue;
      ages[i] += dt;
      if (ages[i] >= LIFE) {
        ages[i] = -1;
        positions[i * 3 + 1] = OFFSCREEN_Y;
        liveCount--;
        continue;
      }
      velocities[i * 3 + 1] -= GRAVITY * dt;
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { burst, update };
}
