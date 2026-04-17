/**
 * Smoke + embers for active furnaces.
 *
 * Two shared Points clouds (smoke + embers) with ring-buffer pools: for every
 * active furnace each frame we stochastically push new particles seeded at the
 * chimney top (smoke) or the front glow face (embers). Smoke rises + drifts
 * slowly; embers spit forward with gravity pulling them back down.
 *
 * No dynamic PointLight: firelight shadows on a cubemap are a 6-pass render
 * every time a furnace activates, which produced a multi-hundred-ms stutter
 * on start. The emissive glow face (furnaceInstancer) + the tile-light grid
 * (lighting.js) cover the gameplay and visual cues without touching shadows.
 *
 * All effects render only when the furnace has `activeBillId > 0` — the tile
 * light contribution from this furnace (see lighting.js) follows the same
 * gate, so the visual + pathing cues stay in lockstep.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER } from '../world/coords.js';
import { FACING_OFFSETS } from '../world/facing.js';
import { CHIMNEY_TOP_Y, FRONT_GLOW_Y, FURNACE_FOOTPRINT } from './furnaceInstancer.js';

// Shared park-position for expired particles; keeps them off-camera without
// rebuilding the draw range. Same trick as roofCollapseParticles.
const OFFSCREEN_Y = -1e6;

const MAX_SMOKE = 600;
const SMOKE_LIFE = 2.4;
const SMOKE_RISE = 1.4 * UNITS_PER_METER;
const SMOKE_DRIFT = 0.35 * UNITS_PER_METER;
const SMOKE_SPAWN_INTERVAL = 0.14;
const SMOKE_SIZE = 0.4 * UNITS_PER_METER;

const MAX_EMBERS = 400;
const EMBER_LIFE = 0.9;
const EMBER_GRAVITY = 11 * UNITS_PER_METER;
const EMBER_VEL_FWD = 2.2 * UNITS_PER_METER;
const EMBER_VEL_UP = 1.6 * UNITS_PER_METER;
const EMBER_VEL_SIDE = 1.1 * UNITS_PER_METER;
const EMBER_SPAWN_INTERVAL = 0.18;
const EMBER_SIZE = 0.16 * UNITS_PER_METER;

/**
 * @param {THREE.Scene} scene
 */
export function createFurnaceEffects(scene) {
  const smokePositions = new Float32Array(MAX_SMOKE * 3);
  const smokeVelocities = new Float32Array(MAX_SMOKE * 3);
  const smokeAges = new Float32Array(MAX_SMOKE);
  for (let i = 0; i < MAX_SMOKE; i++) {
    smokePositions[i * 3 + 1] = OFFSCREEN_Y;
    smokeAges[i] = -1;
  }
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  const smokeMat = new THREE.PointsMaterial({
    color: 0x8a8680,
    size: SMOKE_SIZE,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const smokePoints = new THREE.Points(smokeGeo, smokeMat);
  smokePoints.frustumCulled = false;
  scene.add(smokePoints);

  const emberPositions = new Float32Array(MAX_EMBERS * 3);
  const emberVelocities = new Float32Array(MAX_EMBERS * 3);
  const emberAges = new Float32Array(MAX_EMBERS);
  for (let i = 0; i < MAX_EMBERS; i++) {
    emberPositions[i * 3 + 1] = OFFSCREEN_Y;
    emberAges[i] = -1;
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const emberMat = new THREE.PointsMaterial({
    color: 0xffb060,
    size: EMBER_SIZE,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const emberPoints = new THREE.Points(emberGeo, emberMat);
  emberPoints.frustumCulled = false;
  scene.add(emberPoints);

  let smokeCursor = 0;
  let smokeLive = 0;
  let emberCursor = 0;
  let emberLive = 0;

  /** Per-furnace emission accumulators, keyed by entity id. */
  /** @type {Map<number, { smoke: number, ember: number }>} */
  const emitters = new Map();

  /** Reused per-frame live-furnace set for emitter GC. */
  /** @type {Set<number>} */
  const alive = new Set();

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {number} dt
   */
  function update(world, grid, dt) {
    alive.clear();

    const halfW = grid.W / 2;
    const halfH = grid.H / 2;
    for (const { id, components } of world.query(['Furnace', 'TileAnchor', 'FurnaceViz'])) {
      if (components.Furnace.activeBillId <= 0) continue;
      alive.add(id);

      const a = components.TileAnchor;
      const wx = (a.i + 0.5 - halfW) * TILE_SIZE;
      const wz = (a.j + 0.5 - halfH) * TILE_SIZE;
      const y = grid.getElevation(a.i, a.j);
      const facing = components.Furnace.facing | 0;
      const off = FACING_OFFSETS[facing] ?? FACING_OFFSETS[0];

      const chimneyX = wx;
      const chimneyY = y + CHIMNEY_TOP_Y;
      const chimneyZ = wz;

      const frontX = wx + off.di * FURNACE_FOOTPRINT * 0.5;
      const frontY = y + FRONT_GLOW_Y;
      const frontZ = wz + off.dj * FURNACE_FOOTPRINT * 0.5;

      let acc = emitters.get(id);
      if (!acc) {
        acc = { smoke: 0, ember: 0 };
        emitters.set(id, acc);
      }
      acc.smoke += dt;
      acc.ember += dt;
      while (acc.smoke >= SMOKE_SPAWN_INTERVAL) {
        acc.smoke -= SMOKE_SPAWN_INTERVAL;
        spawnSmoke(chimneyX, chimneyY, chimneyZ);
      }
      while (acc.ember >= EMBER_SPAWN_INTERVAL) {
        acc.ember -= EMBER_SPAWN_INTERVAL;
        spawnEmber(frontX, frontY, frontZ, off.di, off.dj);
      }
    }

    for (const id of emitters.keys()) {
      if (!alive.has(id)) emitters.delete(id);
    }

    stepSmoke(dt);
    stepEmbers(dt);
  }

  /** @param {number} x @param {number} y @param {number} z */
  function spawnSmoke(x, y, z) {
    const i = smokeCursor;
    smokeCursor = (smokeCursor + 1) % MAX_SMOKE;
    if (smokeAges[i] < 0) smokeLive++;
    smokePositions[i * 3] = x + (Math.random() - 0.5) * TILE_SIZE * 0.1;
    smokePositions[i * 3 + 1] = y;
    smokePositions[i * 3 + 2] = z + (Math.random() - 0.5) * TILE_SIZE * 0.1;
    smokeVelocities[i * 3] = (Math.random() - 0.5) * SMOKE_DRIFT;
    smokeVelocities[i * 3 + 1] = SMOKE_RISE * (0.7 + Math.random() * 0.6);
    smokeVelocities[i * 3 + 2] = (Math.random() - 0.5) * SMOKE_DRIFT;
    smokeAges[i] = 0;
  }

  /**
   * @param {number} x @param {number} y @param {number} z
   * @param {number} di @param {number} dj
   */
  function spawnEmber(x, y, z, di, dj) {
    const i = emberCursor;
    emberCursor = (emberCursor + 1) % MAX_EMBERS;
    if (emberAges[i] < 0) emberLive++;
    emberPositions[i * 3] = x;
    emberPositions[i * 3 + 1] = y;
    emberPositions[i * 3 + 2] = z;
    const sideX = -dj;
    const sideZ = di;
    const side = (Math.random() - 0.5) * EMBER_VEL_SIDE;
    emberVelocities[i * 3] = di * EMBER_VEL_FWD * (0.6 + Math.random() * 0.8) + sideX * side;
    emberVelocities[i * 3 + 1] = EMBER_VEL_UP * (0.6 + Math.random() * 0.9);
    emberVelocities[i * 3 + 2] = dj * EMBER_VEL_FWD * (0.6 + Math.random() * 0.8) + sideZ * side;
    emberAges[i] = 0;
  }

  /** @param {number} dt */
  function stepSmoke(dt) {
    if (smokeLive === 0) return;
    const drag = Math.exp(-0.9 * dt);
    for (let i = 0; i < MAX_SMOKE; i++) {
      if (smokeAges[i] < 0) continue;
      smokeAges[i] += dt;
      if (smokeAges[i] >= SMOKE_LIFE) {
        smokeAges[i] = -1;
        smokePositions[i * 3 + 1] = OFFSCREEN_Y;
        smokeLive--;
        continue;
      }
      smokeVelocities[i * 3] *= drag;
      smokeVelocities[i * 3 + 2] *= drag;
      smokePositions[i * 3] += smokeVelocities[i * 3] * dt;
      smokePositions[i * 3 + 1] += smokeVelocities[i * 3 + 1] * dt;
      smokePositions[i * 3 + 2] += smokeVelocities[i * 3 + 2] * dt;
    }
    smokeGeo.attributes.position.needsUpdate = true;
  }

  /** @param {number} dt */
  function stepEmbers(dt) {
    if (emberLive === 0) return;
    for (let i = 0; i < MAX_EMBERS; i++) {
      if (emberAges[i] < 0) continue;
      emberAges[i] += dt;
      if (emberAges[i] >= EMBER_LIFE) {
        emberAges[i] = -1;
        emberPositions[i * 3 + 1] = OFFSCREEN_Y;
        emberLive--;
        continue;
      }
      emberVelocities[i * 3 + 1] -= EMBER_GRAVITY * dt;
      emberPositions[i * 3] += emberVelocities[i * 3] * dt;
      emberPositions[i * 3 + 1] += emberVelocities[i * 3 + 1] * dt;
      emberPositions[i * 3 + 2] += emberVelocities[i * 3 + 2] * dt;
    }
    emberGeo.attributes.position.needsUpdate = true;
  }

  return { update };
}
