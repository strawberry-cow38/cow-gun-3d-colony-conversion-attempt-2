/**
 * Torch render: a stick InstancedMesh (brown cylinder) plus a flame
 * InstancedMesh (orange emissive cone). The flame flickers per-torch by
 * scaling Y and nudging emissive intensity with a hashed time offset so
 * neighboring torches don't flicker in lockstep.
 *
 * Torches are static-position but the flame is animated, so matrix buffers
 * rebuild every frame (count stays small — one torch is rarely hundreds).
 * Stick matrices rebuild on the same pass to keep one dirty path.
 *
 * A small pool of PointLights is assigned to the N closest torches to the
 * camera each frame — WebGL caps total dynamic lights per draw call, so we
 * can't naively light one-per-torch once a colony grows. The lights are
 * purely visual; the gameplay lighting grid (src/systems/lighting.js) is
 * unaffected.
 */

import * as THREE from 'three';
import { TORCH_RADIUS_TILES } from '../systems/lighting.js';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const STICK_HEIGHT = 1.6 * UNITS_PER_METER;
const STICK_RADIUS = 0.06 * UNITS_PER_METER;
const FLAME_HEIGHT = 0.5 * UNITS_PER_METER;
const FLAME_RADIUS = 0.18 * UNITS_PER_METER;
// Flame tip sits roughly at stick top + half flame height.
const FLAME_CENTER_Y = STICK_HEIGHT + FLAME_HEIGHT * 0.85;
const POINT_LIGHT_POOL = 12;
// Match the tile-lighting reach: TORCH_RADIUS_TILES counts the center tile,
// so the euclidean reach from the torch is (TORCH_RADIUS_TILES - 1) tiles.
const POINT_LIGHT_DISTANCE = (TORCH_RADIUS_TILES - 1) * TILE_SIZE;
// Three r155+ uses physical units with decay=2; tuned so a torch clearly
// lights the ground out to POINT_LIGHT_DISTANCE without overpowering day.
const POINT_LIGHT_INTENSITY = 120;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createTorchInstancer(scene, capacity = 512) {
  const stickGeo = new THREE.CylinderGeometry(
    STICK_RADIUS * 0.85,
    STICK_RADIUS,
    STICK_HEIGHT,
    6,
    1,
  );
  stickGeo.translate(0, STICK_HEIGHT * 0.5, 0);
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x5a3820, flatShading: true });
  const stick = new THREE.InstancedMesh(stickGeo, stickMat, capacity);
  stick.count = 0;
  stick.frustumCulled = false;
  scene.add(stick);

  const flameGeo = new THREE.ConeGeometry(FLAME_RADIUS, FLAME_HEIGHT, 6, 1);
  flameGeo.translate(0, STICK_HEIGHT + FLAME_HEIGHT * 0.5, 0);
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xffb040,
    emissive: 0xff7a1a,
    emissiveIntensity: 1.8,
    flatShading: true,
    transparent: true,
    opacity: 0.92,
  });
  const flame = new THREE.InstancedMesh(flameGeo, flameMat, capacity);
  flame.count = 0;
  flame.frustumCulled = false;
  scene.add(flame);

  const pointLights = /** @type {THREE.PointLight[]} */ ([]);
  for (let i = 0; i < POINT_LIGHT_POOL; i++) {
    const pl = new THREE.PointLight(0xff8040, 0, POINT_LIGHT_DISTANCE, 2);
    pl.visible = false;
    scene.add(pl);
    pointLights.push(pl);
  }
  // Scratch buffer reused every frame — entry is [worldX, worldY, worldZ,
  // flicker, distSqToCamera]. Avoids per-frame allocation in the hot path.
  const scratch = /** @type {number[][]} */ ([]);

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {number} tSec
   * @param {THREE.Camera} [camera]
   */
  function update(world, grid, tSec, camera) {
    let n = 0;
    _quat.identity();
    let scratchN = 0;
    const camX = camera?.position.x ?? 0;
    const camY = camera?.position.y ?? 0;
    const camZ = camera?.position.z ?? 0;
    for (const { id, components } of world.query(['Torch', 'TileAnchor', 'TorchViz'])) {
      if (n >= capacity) break;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);

      // Deterministic per-torch phase offset so adjacent torches flicker
      // independently. Hash the entity id into [0, 2π).
      const phase = (id * 0.6180339887) % 1;
      const t = tSec * 6.0 + phase * Math.PI * 2;
      const flicker = 0.85 + 0.18 * Math.sin(t) + 0.1 * Math.sin(t * 1.73 + 1.1);

      _scale.set(1, 1, 1);
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      stick.setMatrixAt(n, _matrix);

      _scale.set(flicker, flicker, flicker);
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      flame.setMatrixAt(n, _matrix);

      const lightY = y + FLAME_CENTER_Y;
      const dx = w.x - camX;
      const dy = lightY - camY;
      const dz = w.z - camZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      let slot = scratch[scratchN];
      if (!slot) {
        slot = [0, 0, 0, 0, 0];
        scratch[scratchN] = slot;
      }
      slot[0] = w.x;
      slot[1] = lightY;
      slot[2] = w.z;
      slot[3] = flicker;
      slot[4] = d2;
      scratchN++;

      n++;
    }

    stick.count = n;
    flame.count = n;
    stick.instanceMatrix.needsUpdate = true;
    flame.instanceMatrix.needsUpdate = true;

    // Pick the N nearest torches and drive the PointLight pool. Partial
    // sort would be marginal at 12 slots out of a typical few dozen torches;
    // full sort is fine here and stays O(n log n) on a small n.
    scratch.length = scratchN;
    scratch.sort((a, b) => a[4] - b[4]);
    const assigned = Math.min(scratchN, pointLights.length);
    for (let i = 0; i < assigned; i++) {
      const [lx, ly, lz, flicker] = scratch[i];
      const pl = pointLights[i];
      pl.position.set(lx, ly, lz);
      pl.intensity = POINT_LIGHT_INTENSITY * flicker;
      pl.visible = true;
    }
    for (let i = assigned; i < pointLights.length; i++) {
      pointLights[i].visible = false;
      pointLights[i].intensity = 0;
    }
  }

  return { update };
}
