/**
 * Ambient cosmetic particles: butterflies by day, fireflies by night, falling
 * leaves from mature trees any time of day.
 *
 * All three share the `THREE.Points` ring-buffer pattern used by roof-collapse
 * dust and furnace smoke — per-particle position + velocity + age in aligned
 * Float32Arrays, one draw call per pool, no per-spawn GC. Each pool has its
 * own sprite texture + blending mode; per-particle color is written into a
 * vertex attribute so butterflies can inherit their flower's tint.
 *
 * The butterfly emitter needs flower world positions. Rather than scan the
 * tile grid every spawn, we cache a flat list and rebuild only when the
 * flower instancer reports the grid dirty (same dirty pulse — build/till/etc).
 * Trees are queried on demand for the leaf/firefly emitters; live tree counts
 * are low enough that an on-demand random pick is cheaper than a cache we'd
 * have to keep in sync with chop/plant events.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { flowerKind } from '../world/flowers.js';
import { BIOME } from '../world/tileGrid.js';
import { TREE_KINDS } from '../world/trees.js';

const OFFSCREEN_Y = -1e6;

// --- Butterflies -----------------------------------------------------------
const MAX_BUTTERFLIES = 80;
const BUTTERFLY_LIFE = 9;
const BUTTERFLY_SIZE = 0.8 * UNITS_PER_METER;
const BUTTERFLY_FADE = 1.2; // seconds of fade-in and fade-out at life edges
// Desired peak live population. Spawn rate = pop / life, gated on sun%.
const BUTTERFLY_PEAK_POP = 28;

// --- Fireflies -------------------------------------------------------------
const MAX_FIREFLIES = 80;
const FIREFLY_LIFE = 6;
const FIREFLY_SIZE = 0.5 * UNITS_PER_METER;
const FIREFLY_FADE = 0.8;
const FIREFLY_PEAK_POP = 32;

// --- Falling leaves --------------------------------------------------------
const MAX_LEAVES = 48;
const LEAF_LIFE = 6;
const LEAF_SIZE = 0.5 * UNITS_PER_METER;
const LEAF_FADE = 0.6;
// One leaf drop every ~1.8s across all trees combined. Low rate — we want
// occasional drift, not a blizzard.
const LEAF_INTERVAL = 1.8;
const LEAF_GRAVITY = 1.1 * UNITS_PER_METER;
const LEAF_WOBBLE = 1.1 * UNITS_PER_METER;

/** @typedef {{ x: number, y: number, z: number, r: number, g: number, b: number }} FlowerEmitter */

/**
 * @param {THREE.Scene} scene
 * @param {import('../world/tileGrid.js').TileGrid} tileGrid
 */
export function createAmbientParticles(scene, tileGrid) {
  const butterfly = makeButterflyPool(scene);
  const firefly = makeFireflyPool(scene);
  const leaf = makeLeafPool(scene);

  /** @type {FlowerEmitter[]} */
  let flowers = [];
  let flowersDirty = true;
  let leafAcc = 0;
  let butterflyAcc = 0;
  let fireflyAcc = 0;

  function rebuildFlowerCache() {
    flowers = [];
    const { W, H } = tileGrid;
    const scratch = new THREE.Color();
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const kind = tileGrid.flower[k];
        if (kind === 0) continue;
        if (tileGrid.biome[k] !== BIOME.GRASS) continue;
        if (tileGrid.wall[k] || tileGrid.floor[k] || tileGrid.roof[k]) continue;
        if (tileGrid.tilled[k] || tileGrid.farmZone[k]) continue;
        const w = tileToWorld(i, j, W, H);
        const hash = (k * 2654435761) >>> 0;
        const jitterX = ((hash & 0xff) / 255 - 0.5) * TILE_SIZE * 0.55;
        const jitterZ = (((hash >>> 8) & 0xff) / 255 - 0.5) * TILE_SIZE * 0.55;
        scratch.set(flowerKind(kind).butterflyColor);
        flowers.push({
          x: w.x + jitterX,
          y: tileGrid.getElevation(i, j),
          z: w.z + jitterZ,
          r: scratch.r,
          g: scratch.g,
          b: scratch.b,
        });
      }
    }
    flowersDirty = false;
  }

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {number} rdt
   * @param {number} sunPct 0 = night, 1 = full sun
   */
  function update(world, rdt, sunPct) {
    if (flowersDirty) rebuildFlowerCache();

    // Butterflies: spawn during daylight, proportional to sun%.
    if (sunPct > 0.05 && flowers.length > 0) {
      const rate = (BUTTERFLY_PEAK_POP / BUTTERFLY_LIFE) * sunPct;
      butterflyAcc += rdt * rate;
      while (butterflyAcc >= 1) {
        butterflyAcc -= 1;
        spawnButterfly(butterfly, flowers);
      }
    }

    // Fireflies: spawn at night near trees. Only query the ECS once the
    // accumulator is about to fire a spawn — the tree scan is the cost, so
    // don't pay it every frame just to watch `fireflyAcc` creep up.
    if (sunPct < 0.6) {
      const rate = (FIREFLY_PEAK_POP / FIREFLY_LIFE) * (1 - sunPct);
      fireflyAcc += rdt * rate;
      if (fireflyAcc >= 1) {
        const trees = sampleTreePositions(world, tileGrid, 6);
        if (trees.length > 0) {
          while (fireflyAcc >= 1) {
            fireflyAcc -= 1;
            spawnFirefly(firefly, trees);
          }
        } else {
          fireflyAcc = 0;
        }
      }
    }

    // Leaves: slow, constant drip from mature trees (kind-tinted).
    leafAcc += rdt;
    while (leafAcc >= LEAF_INTERVAL) {
      leafAcc -= LEAF_INTERVAL;
      const tree = pickMatureTree(world, tileGrid);
      if (tree) spawnLeaf(leaf, tree);
    }

    updateButterflies(butterfly, rdt);
    updateFireflies(firefly, rdt);
    updateLeaves(leaf, rdt);
  }

  function markFlowersDirty() {
    flowersDirty = true;
  }

  return { update, markFlowersDirty };
}

// ---------------------------------------------------------------------------
// Butterfly pool

/** @param {THREE.Scene} scene */
function makeButterflyPool(scene) {
  const positions = new Float32Array(MAX_BUTTERFLIES * 3);
  const colors = new Float32Array(MAX_BUTTERFLIES * 3);
  const baseColors = new Float32Array(MAX_BUTTERFLIES * 3);
  const ages = new Float32Array(MAX_BUTTERFLIES);
  const targetX = new Float32Array(MAX_BUTTERFLIES);
  const targetY = new Float32Array(MAX_BUTTERFLIES);
  const targetZ = new Float32Array(MAX_BUTTERFLIES);
  const wobblePhase = new Float32Array(MAX_BUTTERFLIES);
  const orbitR = new Float32Array(MAX_BUTTERFLIES);
  const orbitSpeed = new Float32Array(MAX_BUTTERFLIES);
  for (let i = 0; i < MAX_BUTTERFLIES; i++) {
    positions[i * 3 + 1] = OFFSCREEN_Y;
    ages[i] = -1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: BUTTERFLY_SIZE,
    map: buildButterflyTexture(),
    vertexColors: true,
    transparent: true,
    alphaTest: 0.2,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let cursor = 0;
  return {
    geo,
    positions,
    colors,
    baseColors,
    ages,
    targetX,
    targetY,
    targetZ,
    wobblePhase,
    orbitR,
    orbitSpeed,
    getCursor: () => cursor,
    advance: () => {
      cursor = (cursor + 1) % MAX_BUTTERFLIES;
    },
  };
}

/** @param {ReturnType<typeof makeButterflyPool>} pool @param {FlowerEmitter[]} flowers */
function spawnButterfly(pool, flowers) {
  const f = flowers[Math.floor(Math.random() * flowers.length)];
  const i = pool.getCursor();
  pool.advance();
  const riseY = (0.5 + Math.random() * 1.2) * UNITS_PER_METER;
  pool.positions[i * 3] = f.x + (Math.random() - 0.5) * TILE_SIZE;
  pool.positions[i * 3 + 1] = f.y + riseY;
  pool.positions[i * 3 + 2] = f.z + (Math.random() - 0.5) * TILE_SIZE;
  pool.targetX[i] = f.x;
  pool.targetY[i] = f.y + riseY;
  pool.targetZ[i] = f.z;
  pool.orbitR[i] = (0.4 + Math.random() * 0.9) * UNITS_PER_METER;
  pool.orbitSpeed[i] = 1.2 + Math.random() * 1.6;
  pool.wobblePhase[i] = Math.random() * Math.PI * 2;
  pool.baseColors[i * 3] = f.r;
  pool.baseColors[i * 3 + 1] = f.g;
  pool.baseColors[i * 3 + 2] = f.b;
  pool.ages[i] = 0;
}

/** @param {ReturnType<typeof makeButterflyPool>} pool @param {number} rdt */
function updateButterflies(pool, rdt) {
  let dirty = false;
  for (let i = 0; i < MAX_BUTTERFLIES; i++) {
    if (pool.ages[i] < 0) continue;
    pool.ages[i] += rdt;
    dirty = true;
    if (pool.ages[i] >= BUTTERFLY_LIFE) {
      pool.ages[i] = -1;
      pool.positions[i * 3 + 1] = OFFSCREEN_Y;
      pool.colors[i * 3] = 0;
      pool.colors[i * 3 + 1] = 0;
      pool.colors[i * 3 + 2] = 0;
      continue;
    }
    pool.wobblePhase[i] += rdt * pool.orbitSpeed[i];
    const phase = pool.wobblePhase[i];
    const r = pool.orbitR[i];
    pool.positions[i * 3] = pool.targetX[i] + Math.cos(phase) * r;
    pool.positions[i * 3 + 1] = pool.targetY[i] + Math.sin(phase * 2) * (0.12 * UNITS_PER_METER);
    pool.positions[i * 3 + 2] = pool.targetZ[i] + Math.sin(phase) * r;
    const fade = lifeFade(pool.ages[i], BUTTERFLY_LIFE, BUTTERFLY_FADE);
    pool.colors[i * 3] = pool.baseColors[i * 3] * fade;
    pool.colors[i * 3 + 1] = pool.baseColors[i * 3 + 1] * fade;
    pool.colors[i * 3 + 2] = pool.baseColors[i * 3 + 2] * fade;
  }
  if (dirty) {
    pool.geo.attributes.position.needsUpdate = true;
    pool.geo.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Firefly pool

/** @param {THREE.Scene} scene */
function makeFireflyPool(scene) {
  const positions = new Float32Array(MAX_FIREFLIES * 3);
  const colors = new Float32Array(MAX_FIREFLIES * 3);
  const ages = new Float32Array(MAX_FIREFLIES);
  const velX = new Float32Array(MAX_FIREFLIES);
  const velY = new Float32Array(MAX_FIREFLIES);
  const velZ = new Float32Array(MAX_FIREFLIES);
  const pulsePhase = new Float32Array(MAX_FIREFLIES);
  for (let i = 0; i < MAX_FIREFLIES; i++) {
    positions[i * 3 + 1] = OFFSCREEN_Y;
    ages[i] = -1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: FIREFLY_SIZE,
    map: buildGlowTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let cursor = 0;
  return {
    geo,
    positions,
    colors,
    ages,
    velX,
    velY,
    velZ,
    pulsePhase,
    getCursor: () => cursor,
    advance: () => {
      cursor = (cursor + 1) % MAX_FIREFLIES;
    },
  };
}

/** @param {ReturnType<typeof makeFireflyPool>} pool @param {{x:number,y:number,z:number}[]} trees */
function spawnFirefly(pool, trees) {
  const t = trees[Math.floor(Math.random() * trees.length)];
  const i = pool.getCursor();
  pool.advance();
  const spread = TILE_SIZE * 1.8;
  pool.positions[i * 3] = t.x + (Math.random() - 0.5) * spread;
  pool.positions[i * 3 + 1] = t.y + (0.8 + Math.random() * 1.6) * UNITS_PER_METER;
  pool.positions[i * 3 + 2] = t.z + (Math.random() - 0.5) * spread;
  pool.velX[i] = (Math.random() - 0.5) * 0.3 * UNITS_PER_METER;
  pool.velY[i] = (Math.random() - 0.3) * 0.15 * UNITS_PER_METER;
  pool.velZ[i] = (Math.random() - 0.5) * 0.3 * UNITS_PER_METER;
  pool.pulsePhase[i] = Math.random() * Math.PI * 2;
  pool.ages[i] = 0;
}

/** @param {ReturnType<typeof makeFireflyPool>} pool @param {number} rdt */
function updateFireflies(pool, rdt) {
  let dirty = false;
  for (let i = 0; i < MAX_FIREFLIES; i++) {
    if (pool.ages[i] < 0) continue;
    pool.ages[i] += rdt;
    dirty = true;
    if (pool.ages[i] >= FIREFLY_LIFE) {
      pool.ages[i] = -1;
      pool.positions[i * 3 + 1] = OFFSCREEN_Y;
      pool.colors[i * 3] = 0;
      pool.colors[i * 3 + 1] = 0;
      pool.colors[i * 3 + 2] = 0;
      continue;
    }
    // Low-pass-ish wobble so fireflies meander, not dash.
    pool.velX[i] += (Math.random() - 0.5) * 0.3 * UNITS_PER_METER * rdt;
    pool.velZ[i] += (Math.random() - 0.5) * 0.3 * UNITS_PER_METER * rdt;
    pool.velX[i] *= 0.96;
    pool.velZ[i] *= 0.96;
    pool.positions[i * 3] += pool.velX[i] * rdt;
    pool.positions[i * 3 + 1] += pool.velY[i] * rdt;
    pool.positions[i * 3 + 2] += pool.velZ[i] * rdt;
    const fade = lifeFade(pool.ages[i], FIREFLY_LIFE, FIREFLY_FADE);
    const pulse = 0.55 + 0.45 * Math.sin(pool.pulsePhase[i] + pool.ages[i] * 4.5);
    const brightness = fade * pulse;
    pool.colors[i * 3] = 0.95 * brightness;
    pool.colors[i * 3 + 1] = 1.0 * brightness;
    pool.colors[i * 3 + 2] = 0.55 * brightness;
  }
  if (dirty) {
    pool.geo.attributes.position.needsUpdate = true;
    pool.geo.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Leaf pool

/** @param {THREE.Scene} scene */
function makeLeafPool(scene) {
  const positions = new Float32Array(MAX_LEAVES * 3);
  const colors = new Float32Array(MAX_LEAVES * 3);
  const ages = new Float32Array(MAX_LEAVES);
  const velX = new Float32Array(MAX_LEAVES);
  const velZ = new Float32Array(MAX_LEAVES);
  const wobblePhase = new Float32Array(MAX_LEAVES);
  for (let i = 0; i < MAX_LEAVES; i++) {
    positions[i * 3 + 1] = OFFSCREEN_Y;
    ages[i] = -1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: LEAF_SIZE,
    map: buildLeafTexture(),
    vertexColors: true,
    transparent: true,
    alphaTest: 0.2,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let cursor = 0;
  return {
    geo,
    positions,
    colors,
    ages,
    velX,
    velZ,
    wobblePhase,
    getCursor: () => cursor,
    advance: () => {
      cursor = (cursor + 1) % MAX_LEAVES;
    },
  };
}

/** @type {Record<(typeof TREE_KINDS)[number], THREE.Color>} */
const LEAF_KIND_COLOR = {
  birch: new THREE.Color(0xe8c060),
  pine: new THREE.Color(0x6a8a4a),
  oak: new THREE.Color(0xb07030),
  maple: new THREE.Color(0xd84a2e),
};
const LEAF_FALLBACK_COLOR = new THREE.Color(0x8a9c4a);

/** @param {ReturnType<typeof makeLeafPool>} pool @param {{x:number,y:number,z:number,kind:(typeof TREE_KINDS)[number]}} tree */
function spawnLeaf(pool, tree) {
  const i = pool.getCursor();
  pool.advance();
  const canopyY = tree.y + (2.5 + Math.random() * 1.5) * UNITS_PER_METER;
  pool.positions[i * 3] = tree.x + (Math.random() - 0.5) * TILE_SIZE * 0.8;
  pool.positions[i * 3 + 1] = canopyY;
  pool.positions[i * 3 + 2] = tree.z + (Math.random() - 0.5) * TILE_SIZE * 0.8;
  pool.velX[i] = (Math.random() - 0.5) * 0.6 * UNITS_PER_METER;
  pool.velZ[i] = (Math.random() - 0.5) * 0.6 * UNITS_PER_METER;
  pool.wobblePhase[i] = Math.random() * Math.PI * 2;
  const tint = LEAF_KIND_COLOR[tree.kind] ?? LEAF_FALLBACK_COLOR;
  pool.colors[i * 3] = tint.r;
  pool.colors[i * 3 + 1] = tint.g;
  pool.colors[i * 3 + 2] = tint.b;
  pool.geo.attributes.color.needsUpdate = true;
  pool.ages[i] = 0;
}

/** @param {ReturnType<typeof makeLeafPool>} pool @param {number} rdt */
function updateLeaves(pool, rdt) {
  let dirty = false;
  for (let i = 0; i < MAX_LEAVES; i++) {
    if (pool.ages[i] < 0) continue;
    pool.ages[i] += rdt;
    dirty = true;
    if (pool.ages[i] >= LEAF_LIFE) {
      pool.ages[i] = -1;
      pool.positions[i * 3 + 1] = OFFSCREEN_Y;
      continue;
    }
    // Gravity pulls down slowly, wobble adds lateral sway so the leaf drifts
    // like a real one instead of dropping straight.
    pool.wobblePhase[i] += rdt * 2.5;
    const wobble = Math.sin(pool.wobblePhase[i]) * LEAF_WOBBLE;
    pool.positions[i * 3] += (pool.velX[i] + wobble * 0.5) * rdt;
    pool.positions[i * 3 + 1] -= LEAF_GRAVITY * rdt;
    pool.positions[i * 3 + 2] +=
      (pool.velZ[i] + Math.cos(pool.wobblePhase[i]) * LEAF_WOBBLE * 0.5) * rdt;
    const fade = lifeFade(pool.ages[i], LEAF_LIFE, LEAF_FADE);
    if (fade < 0.05) pool.positions[i * 3 + 1] = OFFSCREEN_Y;
  }
  if (dirty) pool.geo.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Shared helpers

/** Triangular ramp: 0 at spawn, 1 at mid-life, 0 at death. */
function lifeFade(age, life, fadeDur) {
  if (age < fadeDur) return age / fadeDur;
  if (age > life - fadeDur) return Math.max(0, (life - age) / fadeDur);
  return 1;
}

/**
 * Reservoir-sample up to N tree positions. Tiny world-gens may have zero
 * trees — return empty rather than insisting on one, so the firefly branch
 * silently no-ops until someone plants a sapling.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {number} sampleCount
 */
function sampleTreePositions(world, grid, sampleCount) {
  /** @type {{ x: number, y: number, z: number }[]} */
  const reservoir = [];
  let n = 0;
  for (const { components } of world.query(['Tree', 'TileAnchor'])) {
    n++;
    const a = components.TileAnchor;
    const w = tileToWorld(a.i, a.j, grid.W, grid.H);
    const y = grid.getElevation(a.i, a.j);
    const entry = { x: w.x, y, z: w.z };
    if (reservoir.length < sampleCount) {
      reservoir.push(entry);
    } else {
      const idx = Math.floor(Math.random() * n);
      if (idx < sampleCount) reservoir[idx] = entry;
    }
  }
  return reservoir;
}

/**
 * Pick a random mature tree (growth ≥ 0.8) and report its world-space anchor
 * + kind. Returns null when no mature trees exist.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @returns {{ x: number, y: number, z: number, kind: (typeof TREE_KINDS)[number] } | null}
 */
function pickMatureTree(world, grid) {
  let chosen = null;
  let n = 0;
  for (const { components } of world.query(['Tree', 'TileAnchor'])) {
    const t = components.Tree;
    if (t.growth < 0.8) continue;
    n++;
    // Reservoir-sample size 1: replace with probability 1/n.
    if (Math.random() < 1 / n) {
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      chosen = { x: w.x, y: grid.getElevation(a.i, a.j), z: w.z, kind: t.kind };
    }
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Sprite textures

function buildButterflyTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  // Two wing ellipses, slightly tilted — reads as a butterfly from a distance.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.18, cy - size * 0.08, size * 0.2, size * 0.28, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.18, cy - size * 0.08, size * 0.2, size * 0.28, 0.4, 0, Math.PI * 2);
  ctx.fill();
  // Lower wings, smaller.
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.13, cy + size * 0.15, size * 0.13, size * 0.18, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + size * 0.13, cy + size * 0.15, size * 0.13, size * 0.18, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Thin dark body to glue the wings together.
  ctx.strokeStyle = '#2a1a0a';
  ctx.lineWidth = size * 0.045;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.18);
  ctx.lineTo(cx, cy + size * 0.22);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 2;
  return tex;
}

function buildGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.3, 'rgba(255, 255, 180, 0.85)');
  grad.addColorStop(0.8, 'rgba(200, 230, 80, 0.15)');
  grad.addColorStop(1, 'rgba(200, 230, 80, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function buildLeafTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  // Almond-shaped leaf — two arcs meeting at tip + base.
  ctx.moveTo(size / 2, size * 0.1);
  ctx.quadraticCurveTo(size * 0.95, size / 2, size / 2, size * 0.9);
  ctx.quadraticCurveTo(size * 0.05, size / 2, size / 2, size * 0.1);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
