/**
 * Torch render: a stick InstancedMesh (brown cylinder) plus a flame
 * InstancedMesh (orange emissive cone). The flame flickers per-torch by
 * scaling Y and nudging emissive intensity with a hashed time offset so
 * neighboring torches don't flicker in lockstep.
 *
 * Torches are static-position but the flame is animated, so matrix buffers
 * rebuild every frame (count stays small — one torch is rarely hundreds).
 * Stick matrices rebuild on the same pass to keep one dirty path.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const STICK_HEIGHT = 1.6 * UNITS_PER_METER;
const STICK_RADIUS = 0.06 * UNITS_PER_METER;
const FLAME_HEIGHT = 0.5 * UNITS_PER_METER;
const FLAME_RADIUS = 0.18 * UNITS_PER_METER;

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

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {number} tSec
   */
  function update(world, grid, tSec) {
    let n = 0;
    _quat.identity();
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

      n++;
    }

    stick.count = n;
    flame.count = n;
    stick.instanceMatrix.needsUpdate = true;
    flame.instanceMatrix.needsUpdate = true;
  }

  return { update };
}
