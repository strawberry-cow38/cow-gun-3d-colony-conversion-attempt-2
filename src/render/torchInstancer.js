/**
 * Torch render: a stick InstancedMesh (brown cylinder) plus a flame
 * InstancedMesh (orange emissive cone). The flame animates by cycling the
 * shared material's color + emissive over time — no per-instance scale, so
 * the geometry stays rock-steady.
 *
 * Torches are static-position, but we still rebuild matrices each frame
 * anyway to keep stick + flame + light-pool updates on a single dirty path;
 * per-frame cost stays small since torch counts are low.
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
// Only the N closest torch lights cast real shadows — each shadow-casting
// PointLight renders a 6-face cubemap per frame, so the cap keeps cost bounded
// while still giving proper occlusion around the player's current position.
const POINT_LIGHT_SHADOW_CASTERS = 2;
// Match the tile-lighting reach: TORCH_RADIUS_TILES counts the center tile,
// so the euclidean reach from the torch is (TORCH_RADIUS_TILES - 1) tiles.
const POINT_LIGHT_DISTANCE = (TORCH_RADIUS_TILES - 1) * TILE_SIZE;
// Three r155+ uses physical units with decay=2; tuned so a torch clearly
// lights the ground out to POINT_LIGHT_DISTANCE without overpowering day.
const POINT_LIGHT_INTENSITY = 20000;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _flameColor = new THREE.Color();
const _flameEmissive = new THREE.Color();
// Flame color cycle — two hues on a low-frequency sin lerp plus a second
// higher-frequency wobble; produces a slow warm → bright-yellow drift.
const FLAME_COLOR_A = new THREE.Color(0xff8c20);
const FLAME_COLOR_B = new THREE.Color(0xffd070);
const FLAME_EMISSIVE_A = new THREE.Color(0xff6a10);
const FLAME_EMISSIVE_B = new THREE.Color(0xffa040);

// Wall-mounted torches are tilted away from the wall and pushed up against its
// face so the flame appears to lean out of the wall rather than float above a
// tile. Yaw points away-from-wall; positive pitch (with YXZ Euler) leans the
// flame tip in the +local-Z direction which, after the yaw rotation, lands on
// the away-from-wall side.
const WALL_TORCH_TILT = 0.45;
const WALL_TORCH_MOUNT_HEIGHT = 1.8 * UNITS_PER_METER;
const WALL_TORCH_OUTWARD_OFFSET = TILE_SIZE * 0.35;
// Wall-mounted torches are deliberately much smaller than ground torches —
// they're a sconce, not a pole. 0.2 matches the "20%" call.
const WALL_TORCH_SCALE = 0.2;

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
    // First N slots in the pool are pre-configured with shadow cubemaps so
    // we only allocate that VRAM up front, not one per torch. The nearest
    // N torches end up in these slots each frame (sorted-by-distance
    // assignment below).
    if (i < POINT_LIGHT_SHADOW_CASTERS) {
      pl.castShadow = true;
      pl.shadow.mapSize.width = 512;
      pl.shadow.mapSize.height = 512;
      pl.shadow.camera.near = 1;
      pl.shadow.camera.far = POINT_LIGHT_DISTANCE;
      // Small negative bias kills shadow acne on flat walls/floors without
      // introducing visible peter-panning at torch ranges.
      pl.shadow.bias = -0.002;
      pl.shadow.radius = 2;
    }
    scene.add(pl);
    pointLights.push(pl);
  }
  // Scratch buffer reused every frame — entry is [worldX, worldY, worldZ,
  // distSqToCamera]. Avoids per-frame allocation in the hot path.
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
    // Global color cycle — all torches share the same hue at time t. Keeps
    // the render cheap (no per-instance color buffer needed) and the visual
    // "campfire sync" is fine for the scale we're at.
    const cyc = 0.5 + 0.5 * Math.sin(tSec * 1.6);
    const wobble = 0.5 + 0.5 * Math.sin(tSec * 3.7 + 0.9);
    const mix = cyc * 0.7 + wobble * 0.3;
    _flameColor.copy(FLAME_COLOR_A).lerp(FLAME_COLOR_B, mix);
    _flameEmissive.copy(FLAME_EMISSIVE_A).lerp(FLAME_EMISSIVE_B, mix);
    flameMat.color.copy(_flameColor);
    flameMat.emissive.copy(_flameEmissive);
    flameMat.emissiveIntensity = 1.6 + wobble * 0.4;
    const lightIntensity = POINT_LIGHT_INTENSITY * (0.85 + wobble * 0.3);
    for (const { components } of world.query(['Torch', 'TileAnchor', 'TorchViz'])) {
      if (n >= capacity) break;
      const a = components.TileAnchor;
      const torch = components.Torch;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);

      let baseX;
      let baseY;
      let baseZ;
      let lightY;
      if (torch.wallMounted) {
        // Walk back toward the wall by the outward-offset distance (yaw points
        // AWAY from the wall, so the wall side is -sin/-cos). Raise the mount
        // point up the wall so the flame sits at a reading light height.
        const ox = -Math.sin(torch.yaw) * WALL_TORCH_OUTWARD_OFFSET;
        const oz = -Math.cos(torch.yaw) * WALL_TORCH_OUTWARD_OFFSET;
        baseX = w.x + ox;
        baseY = y + WALL_TORCH_MOUNT_HEIGHT;
        baseZ = w.z + oz;
        _euler.set(WALL_TORCH_TILT, torch.yaw, 0);
        _quat.setFromEuler(_euler);
        lightY = baseY + FLAME_CENTER_Y * 0.4;
      } else {
        baseX = w.x;
        baseY = y;
        baseZ = w.z;
        _quat.identity();
        lightY = y + FLAME_CENTER_Y;
      }

      const s = torch.wallMounted ? WALL_TORCH_SCALE : 1;
      _scale.set(s, s, s);
      _position.set(baseX, baseY, baseZ);
      _matrix.compose(_position, _quat, _scale);
      stick.setMatrixAt(n, _matrix);
      flame.setMatrixAt(n, _matrix);

      const dx = baseX - camX;
      const dy = lightY - camY;
      const dz = baseZ - camZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      let slot = scratch[scratchN];
      if (!slot) {
        slot = [0, 0, 0, 0];
        scratch[scratchN] = slot;
      }
      slot[0] = baseX;
      slot[1] = lightY;
      slot[2] = baseZ;
      slot[3] = d2;
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
    scratch.sort((a, b) => a[3] - b[3]);
    const assigned = Math.min(scratchN, pointLights.length);
    for (let i = 0; i < assigned; i++) {
      const [lx, ly, lz] = scratch[i];
      const pl = pointLights[i];
      pl.position.set(lx, ly, lz);
      pl.intensity = lightIntensity;
      pl.visible = true;
    }
    for (let i = assigned; i < pointLights.length; i++) {
      pointLights[i].visible = false;
      pointLights[i].intensity = 0;
    }
  }

  return { update };
}
