/**
 * Water wakes: a shared Points cloud with a ring-buffer pool. Each `burst(x,z)`
 * seeds a small ring of outward-drifting points at Y=0 (water plane). Points
 * fade over their lifetime and shrink velocity via friction, giving the soft
 * expanding ripple look when a cow wades through a tile.
 *
 * Uses a custom ShaderMaterial so each point can fade its own alpha + grow
 * its own size independently — stock PointsMaterial only shares one value
 * across the whole cloud.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER } from '../world/coords.js';

const MAX_PARTICLES = 256;
const PARTICLES_PER_BURST = 10;
const LIFE = 0.95;
const INITIAL_SPEED = 0.55 * UNITS_PER_METER;
const OFFSCREEN_Y = -1e6;

const vertexShader = /* glsl */ `
  attribute float size;
  attribute float alpha;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float a = vAlpha * (1.0 - smoothstep(0.25, 0.5, d));
    gl_FragColor = vec4(0.86, 0.95, 1.0, a);
  }
`;

/**
 * @param {THREE.Scene} scene
 */
export function createWakeParticles(scene) {
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const ages = new Float32Array(MAX_PARTICLES);
  const sizes = new Float32Array(MAX_PARTICLES);
  const alphas = new Float32Array(MAX_PARTICLES);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    positions[i * 3 + 1] = OFFSCREEN_Y;
    ages[i] = -1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let cursor = 0;
  let liveCount = 0;

  /** @param {number} x @param {number} z */
  function burst(x, z) {
    for (let n = 0; n < PARTICLES_PER_BURST; n++) {
      const i = cursor;
      cursor = (cursor + 1) % MAX_PARTICLES;
      if (ages[i] < 0) liveCount++;
      const ang = (n / PARTICLES_PER_BURST) * Math.PI * 2 + Math.random() * 0.4;
      const spd = INITIAL_SPEED * (0.7 + Math.random() * 0.6);
      positions[i * 3] = x;
      positions[i * 3 + 1] = 0.02 * UNITS_PER_METER;
      positions[i * 3 + 2] = z;
      velocities[i * 3] = Math.cos(ang) * spd;
      velocities[i * 3 + 1] = 0;
      velocities[i * 3 + 2] = Math.sin(ang) * spd;
      ages[i] = 0;
      sizes[i] = TILE_SIZE * 0.12;
      alphas[i] = 0.85;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
  }

  /** @param {number} dt */
  function update(dt) {
    if (liveCount === 0) return;
    const friction = Math.exp(-dt * 2);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (ages[i] < 0) continue;
      ages[i] += dt;
      if (ages[i] >= LIFE) {
        ages[i] = -1;
        positions[i * 3 + 1] = OFFSCREEN_Y;
        alphas[i] = 0;
        liveCount--;
        continue;
      }
      const t = ages[i] / LIFE;
      positions[i * 3] += velocities[i * 3] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      velocities[i * 3] *= friction;
      velocities[i * 3 + 2] *= friction;
      alphas[i] = 0.85 * (1 - t);
      sizes[i] = TILE_SIZE * (0.08 + 0.28 * t);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
    geo.attributes.alpha.needsUpdate = true;
  }

  return { burst, update };
}
