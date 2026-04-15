/**
 * Flower render: one InstancedMesh of cross-plane billboards (two quads at
 * 90°, like Minecraft foliage) over every grass tile that got a flower roll
 * at terrain-gen. Shared petal texture tinted per-instance by flower kind.
 *
 * Skips tiles that have gained a wall, floor, roof, farm zone, or tilled
 * status — those would bury the flower or conflict with work. Rebuilds on
 * `markDirty()`; the tile mutations that kill flower visibility (build,
 * floor, zone, till, dig) already trip the same dirty paths as other grid
 * renderers, and world-level changes call through here during their systems.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { FLOWER_COUNT, flowerKind } from '../world/flowers.js';
import { BIOME } from '../world/tileGrid.js';

const PETAL_HEIGHT_M = 0.22;
const PETAL_WIDTH_M = 0.16;
const BASE_LIFT = 0.2;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

const PETAL_TINTS = [];
for (let i = 1; i <= FLOWER_COUNT; i++) {
  PETAL_TINTS.push(new THREE.Color(flowerKind(i).petalColor));
}

/**
 * Cross-plane geometry: two vertical quads at 90° so flowers read from any
 * camera angle without billboarding. Built once, reused across all instances.
 */
function buildCrossPlaneGeometry() {
  const w = PETAL_WIDTH_M * UNITS_PER_METER;
  const h = PETAL_HEIGHT_M * UNITS_PER_METER;
  const hx = w / 2;
  const hz = w / 2;
  const positions = new Float32Array([
    // plane A (x-aligned)
    -hx,
    0,
    0,
    hx,
    0,
    0,
    hx,
    h,
    0,
    -hx,
    h,
    0,
    // plane B (z-aligned)
    0,
    0,
    -hz,
    0,
    0,
    hz,
    0,
    h,
    hz,
    0,
    h,
    -hz,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Procedural petal sprite: five petals around a center disc, on a
 * transparent background. Tinted per-instance via setColorAt, so the
 * texture itself is near-white with only the shape painted.
 */
function buildPetalTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size * 0.58;
  const petalR = size * 0.18;
  const petalDist = size * 0.2;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * petalDist;
    const py = cy + Math.sin(a) * petalDist;
    ctx.beginPath();
    ctx.arc(px, py, petalR, 0, Math.PI * 2);
    ctx.fill();
  }
  // Darker center so the tint reads as the petal, not the pistil.
  ctx.fillStyle = '#3a2a10';
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.08, 0, Math.PI * 2);
  ctx.fill();
  // Stem trailing off the bottom so the flower doesn't float.
  ctx.strokeStyle = '#3a6a2a';
  ctx.lineWidth = size * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.08);
  ctx.lineTo(cx, size);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createFlowerInstancer(scene, capacity = 2048) {
  const geo = buildCrossPlaneGeometry();
  const texture = buildPetalTexture();
  const mat = new THREE.MeshLambertMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    alphaTest: 0.35,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  // Prime instanceColor so setColorAt works on the first update.
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  scene.add(mesh);

  let dirty = true;

  /** @param {import('../world/tileGrid.js').TileGrid} grid */
  function update(grid) {
    if (!dirty) return;
    const { W, H } = grid;
    let n = 0;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        if (n >= capacity) break;
        const k = j * W + i;
        const kind = grid.flower[k];
        if (kind === 0) continue;
        if (grid.biome[k] !== BIOME.GRASS) continue;
        if (grid.wall[k] || grid.floor[k] || grid.roof[k]) continue;
        if (grid.tilled[k] || grid.farmZone[k]) continue;
        const w = tileToWorld(i, j, W, H);
        // Sub-tile jitter + Y-rotation so the grid pattern doesn't read like
        // a checkerboard. Deterministic per tile via hash so flowers stay put
        // across frames.
        const h = (k * 2654435761) >>> 0;
        const jitterX = ((h & 0xff) / 255 - 0.5) * TILE_SIZE * 0.55;
        const jitterZ = (((h >>> 8) & 0xff) / 255 - 0.5) * TILE_SIZE * 0.55;
        const yaw = (((h >>> 16) & 0xff) / 255) * Math.PI;
        const s = 0.8 + (((h >>> 24) & 0xff) / 255) * 0.4;
        _position.set(w.x + jitterX, grid.getElevation(i, j) + BASE_LIFT, w.z + jitterZ);
        _quat.setFromAxisAngle(_UP, yaw);
        _scale.set(s, s, s);
        _matrix.compose(_position, _quat, _scale);
        mesh.setMatrixAt(n, _matrix);
        const tint = PETAL_TINTS[Math.min(kind - 1, PETAL_TINTS.length - 1)];
        mesh.setColorAt(n, _color.copy(tint));
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { mesh, update, markDirty };
}

const _UP = new THREE.Vector3(0, 1, 0);
