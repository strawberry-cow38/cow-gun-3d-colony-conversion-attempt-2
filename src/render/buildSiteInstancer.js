/**
 * BuildSite render: translucent blueprint frames for designated-but-unbuilt
 * structures. One shared unit-box geometry is reused for every kind — per
 * instance we scale/translate the box to match what the finished structure
 * will look like (full-height wall box, narrow door slot, thin torch rod,
 * flat roof plate at roof height). Per-kind tinting on top of the
 * waiting→building lerp so the player can tell kinds apart at a glance.
 *
 * Height grows with `delivered / required` so players can see how much
 * material has arrived, and shifts to a warmer tint once a builder has
 * started hammering (`progress > 0`).
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { getStuff } from '../world/stuff.js';
import { FURNACE_FOOTPRINT, FURNACE_HEIGHT } from './furnaceInstancer.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const DOOR_HEIGHT = WALL_HEIGHT * 0.7;
const DOOR_THICKNESS = TILE_SIZE * 0.35;
const TORCH_HEIGHT = 1.6 * UNITS_PER_METER;
const TORCH_THICKNESS = TILE_SIZE * 0.25;
// Match roofInstancer.ROOF_THICKNESS so the blueprint slab and the finished
// slab occupy the same volume.
const ROOF_THICKNESS = 4;
const MIN_DELIVERED_FRAC = 0.15;

const COLOR_WAITING_TORCH = new THREE.Color(0xffd070);
const COLOR_BUILDING = new THREE.Color(0xffd080);
const _tint = new THREE.Color();

/**
 * Per-kind "waiting" tint. Stuff-driven kinds (wall/door/roof) pull their tint
 * from the stuff registry so a stone blueprint reads stone even before it's
 * built. Torches still use a fixed warm glow.
 *
 * @param {string} kind
 * @param {string | undefined} stuff
 * @returns {THREE.Color}
 */
function waitingColorFor(kind, stuff) {
  if (kind === 'torch' || kind === 'wallTorch') return COLOR_WAITING_TORCH;
  return _tint.setHex(getStuff(stuff).blueprintTint);
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createBuildSiteInstancer(scene, capacity = 1024) {
  // Unit box with its base on Y=0 so per-instance Y scaling grows upward
  // without shifting the footing.
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
    transparent: true,
    opacity: 0.45,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    let n = 0;
    _quat.identity();
    for (const { components } of world.query(['BuildSite', 'TileAnchor', 'BuildSiteViz'])) {
      if (n >= capacity) break;
      const site = components.BuildSite;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      const deliveredFrac = Math.min(1, site.delivered / Math.max(1, site.required));
      const yScale = MIN_DELIVERED_FRAC + (1 - MIN_DELIVERED_FRAC) * deliveredFrac;

      let sx = TILE_SIZE;
      let sy = WALL_HEIGHT * yScale;
      let sz = TILE_SIZE;
      let py = y;
      if (site.kind === 'door') {
        sx = TILE_SIZE;
        sy = DOOR_HEIGHT * yScale;
        sz = DOOR_THICKNESS;
      } else if (site.kind === 'torch' || site.kind === 'wallTorch') {
        sx = TORCH_THICKNESS;
        sy = TORCH_HEIGHT * yScale;
        sz = TORCH_THICKNESS;
      } else if (site.kind === 'roof') {
        sx = TILE_SIZE;
        sy = ROOF_THICKNESS;
        sz = TILE_SIZE;
        py = y + WALL_HEIGHT;
      } else if (site.kind === 'furnace') {
        sx = FURNACE_FOOTPRINT;
        sy = FURNACE_HEIGHT * yScale;
        sz = FURNACE_FOOTPRINT;
      }
      _scale.set(sx, sy, sz);
      _position.set(w.x, py, w.z);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(n, _matrix);
      // Warmer hue while a builder is actively hammering (progress > 0),
      // cooler + kind-tinted while waiting for materials/builder.
      const t = Math.min(1, site.progress);
      _color.copy(waitingColorFor(site.kind, site.stuff)).lerp(COLOR_BUILDING, t);
      mesh.setColorAt(n, _color);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // No-op kept for API parity with other instancers — the caller invokes
  // `markDirty()` after world mutations, but since update() rebuilds every
  // frame there's nothing to flag.
  function markDirty() {}

  return { mesh, update, markDirty };
}
