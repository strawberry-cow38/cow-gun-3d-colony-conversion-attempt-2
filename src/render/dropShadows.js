/**
 * Flat blob drop shadows under cows and item stacks. Replaces the directional
 * sun shadow (disabled globally in scene.js) with a cheap, always-on ellipse
 * pinned just above the ground tile each entity stands on.
 *
 * One InstancedMesh of axis-aligned quads, textured with a radial falloff so
 * the blob reads as a soft shadow. Rebuilt every render frame off the cow +
 * item queries — a few hundred matrix composes is cheap, and we skip the
 * cost of shadow-map allocation entirely.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld, worldToTileClamp } from '../world/coords.js';
import { makeShadowTexture } from './dropShadow.js';
import { footprintMeters } from './itemHitboxes.js';

const COW_RADIUS_M = 0.45;
const SHADOW_OPACITY = 0.55;
const SHADOW_LIFT_Y = 0.04 * UNITS_PER_METER;
// Ellipse diameter = footprint width * this factor. Slight overscan so the
// soft radial edge fades past the pile silhouette instead of cutting inside.
const FOOTPRINT_TO_SHADOW = 1.2;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createDropShadows(scene, capacity) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: makeShadowTexture(),
    transparent: true,
    opacity: SHADOW_OPACITY,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);

  _q.identity();

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {number} alpha
   */
  function update(world, grid, alpha) {
    let n = 0;

    for (const { components } of world.query(['Cow', 'Position', 'PrevPosition'])) {
      if (n >= capacity) break;
      const pos = components.Position;
      const prev = components.PrevPosition;
      const x = prev.x + (pos.x - prev.x) * alpha;
      const z = prev.z + (pos.z - prev.z) * alpha;
      const diameter = COW_RADIUS_M * 2 * UNITS_PER_METER;
      const { i, j } = worldToTileClamp(x, z, grid.W, grid.H);
      _p.set(x, grid.getElevation(i, j) + SHADOW_LIFT_Y, z);
      _s.set(diameter, 1, diameter);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(n, _m);
      n++;
    }

    for (const { components } of world.query(['Item', 'TileAnchor', 'ItemViz'])) {
      if (n >= capacity) break;
      const a = components.TileAnchor;
      const item = components.Item;
      const center = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      const fp = footprintMeters(item.kind, item.count, item.capacity);
      const sx = fp.w * FOOTPRINT_TO_SHADOW * UNITS_PER_METER;
      const sz = fp.d * FOOTPRINT_TO_SHADOW * UNITS_PER_METER;
      _p.set(center.x, y + SHADOW_LIFT_Y, center.z);
      _s.set(sx, 1, sz);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(n, _m);
      n++;
    }

    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, update };
}
