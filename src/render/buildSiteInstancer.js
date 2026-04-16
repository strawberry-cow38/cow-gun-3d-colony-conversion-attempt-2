/**
 * BuildSite render: translucent blueprint ghosts that mimic the finished
 * structure. One shared unit-box geometry is reused per instance; the per-kind
 * scale + translation shapes the box into a wall, a door slab + top frame,
 * a roof plate, a torch rod, etc.
 *
 * Color rule: blueprints with no delivered materials render flat gray. Once
 * haulers start dropping resources, the blueprint shifts to the material's
 * finished-product color (wallColor / doorSlabColor / etc. from the stuff
 * registry). Always translucent so the player can still read the terrain
 * through an unbuilt structure.
 *
 * Doors read adjacent wall tiles live each frame (same logic as
 * doorInstancer) so the blueprint faces the right way BEFORE the door is
 * built — no more ghost slabs sticking out perpendicular to the wall run.
 *
 * Rebuilt every frame because `site.delivered` + `site.forbidden` change
 * often and a few hundred matrix composes are cheap.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { doorOrientationAt } from '../world/doorOrientation.js';
import { getStuff } from '../world/stuff.js';
import { BASE_LIFT as FLOOR_LIFT } from './floorInstancer.js';
import { FURNACE_FOOTPRINT, FURNACE_HEIGHT } from './furnaceInstancer.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const DOOR_HEIGHT = 2.4 * UNITS_PER_METER;
const DOOR_THICKNESS = TILE_SIZE * 0.2;
const DOOR_FRAME_HEIGHT = WALL_HEIGHT - DOOR_HEIGHT;
const TORCH_HEIGHT = 1.6 * UNITS_PER_METER;
const TORCH_THICKNESS = TILE_SIZE * 0.25;
const ROOF_THICKNESS = 4;
const FLOOR_THICKNESS = 1;

const COLOR_EMPTY = 0x8a8a8a;
const COLOR_TORCH_FILLED = 0xb87333;
const COLOR_FORBIDDEN = 0x7a4a4a;

// Each entity can emit up to `SLOTS_PER_SITE` instance slots (door = slab +
// frame). Capacity is scaled accordingly at creation.
const SLOTS_PER_SITE = 2;

/**
 * Finished-product color for a blueprint once it has any delivered materials.
 * Mirrors the field each finished instancer reads from `getStuff`.
 *
 * @param {string} kind
 * @param {string | undefined} stuff
 * @param {'slab' | 'frame'} [doorPart]
 */
function filledColorFor(kind, stuff, doorPart) {
  const s = getStuff(stuff);
  if (kind === 'torch' || kind === 'wallTorch') return COLOR_TORCH_FILLED;
  if (kind === 'door') return doorPart === 'frame' ? s.doorFrameColor : s.doorSlabColor;
  if (kind === 'roof') return s.roofColor;
  if (kind === 'floor') return s.floorColor;
  return s.wallColor;
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity  max BuildSites (mesh holds capacity * SLOTS_PER_SITE instances)
 */
export function createBuildSiteInstancer(scene, capacity = 1024) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
    transparent: true,
    opacity: 0.5,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity * SLOTS_PER_SITE);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    let n = 0;
    const cap = capacity * SLOTS_PER_SITE;
    for (const { components } of world.query(['BuildSite', 'TileAnchor', 'BuildSiteViz'])) {
      if (n >= cap) break;
      const site = components.BuildSite;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      const empty = site.delivered <= 0;
      const baseHex = site.forbidden
        ? COLOR_FORBIDDEN
        : empty
          ? COLOR_EMPTY
          : filledColorFor(site.kind, site.stuff);

      if (site.kind === 'door') {
        const { rotateNS } = doorOrientationAt(grid, a.i, a.j);
        _quat.setFromAxisAngle(Y_AXIS, rotateNS ? Math.PI / 2 : 0);
        _scale.set(TILE_SIZE, DOOR_HEIGHT, DOOR_THICKNESS);
        _position.set(w.x, y, w.z);
        _matrix.compose(_position, _quat, _scale);
        mesh.setMatrixAt(n, _matrix);
        _color.setHex(baseHex);
        mesh.setColorAt(n, _color);
        n++;
        if (n >= cap) break;

        // Frame fills the gap between DOOR_HEIGHT and WALL_HEIGHT so the
        // blueprint reads as a doorway inside a wall run.
        _quat.identity();
        _scale.set(TILE_SIZE, DOOR_FRAME_HEIGHT, TILE_SIZE);
        _position.set(w.x, y + DOOR_HEIGHT, w.z);
        _matrix.compose(_position, _quat, _scale);
        mesh.setMatrixAt(n, _matrix);
        _color.setHex(
          site.forbidden
            ? COLOR_FORBIDDEN
            : empty
              ? COLOR_EMPTY
              : filledColorFor('door', site.stuff, 'frame'),
        );
        mesh.setColorAt(n, _color);
        n++;
        continue;
      }

      _quat.identity();
      let sx = TILE_SIZE;
      let sy = WALL_HEIGHT;
      let sz = TILE_SIZE;
      let py = y;
      if (site.kind === 'torch' || site.kind === 'wallTorch') {
        sx = TORCH_THICKNESS;
        sy = TORCH_HEIGHT;
        sz = TORCH_THICKNESS;
      } else if (site.kind === 'roof') {
        sy = ROOF_THICKNESS;
        py = y + WALL_HEIGHT;
      } else if (site.kind === 'floor') {
        sy = FLOOR_THICKNESS;
        py = y + FLOOR_LIFT;
      } else if (site.kind === 'furnace') {
        sx = FURNACE_FOOTPRINT;
        sy = FURNACE_HEIGHT;
        sz = FURNACE_FOOTPRINT;
      }
      _scale.set(sx, sy, sz);
      _position.set(w.x, py, w.z);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(n, _matrix);
      _color.setHex(baseHex);
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
