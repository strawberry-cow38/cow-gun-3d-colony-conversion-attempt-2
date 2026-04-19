/**
 * Invisible click-hitbox InstancedMesh for item stacks. One box per Item
 * entity, sized to the rendered footprint so clicks near (but outside) a
 * stack fall through to the tile picker — letting stockpiles under dropped
 * logs be selected without having to dodge the log.
 *
 * Same raycast-invisible-mesh trick as objectHitboxes: visible=false skips
 * draw, but three's Raycaster still returns hits when you pass the mesh to
 * intersectObject(mesh, false) directly.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

const GENERIC_FOOTPRINT_M = 0.35;
const WOOD_LOG_LENGTH_M = 0.32;
const WOOD_LOG_DIAMETER_M = 0.22;
const WOOD_SCALE = 1.5;
const WOOD_TOP_HEIGHT_M = 0.5;

/**
 * @param {string} kind
 * @param {number} count
 * @param {number} capacity
 */
export function footprintMeters(kind, count, capacity) {
  if (kind === 'wood') {
    const frac = Math.min(1, count / Math.max(1, capacity));
    const tier = Math.min(2, Math.floor(frac * 3));
    const w = WOOD_LOG_LENGTH_M * WOOD_SCALE;
    const d = (tier === 0 ? WOOD_LOG_DIAMETER_M : WOOD_LOG_DIAMETER_M * 2) * WOOD_SCALE;
    const h = (tier === 2 ? WOOD_TOP_HEIGHT_M : WOOD_LOG_DIAMETER_M) * WOOD_SCALE;
    return { w, h, d };
  }
  return { w: GENERIC_FOOTPRINT_M, h: GENERIC_FOOTPRINT_M, d: GENERIC_FOOTPRINT_M };
}

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createItemHitboxes(scene, capacity) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  /** @type {number[]} */
  const slotToEntity = [];

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    let n = 0;
    slotToEntity.length = 0;
    _q.identity();
    for (const { id, components } of world.query(['Item', 'TileAnchor', 'ItemViz'])) {
      if (n >= capacity) break;
      const item = components.Item;
      const anchor = components.TileAnchor;
      const center = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const yBase = grid.getElevation(anchor.i, anchor.j);
      const fp = footprintMeters(item.kind, item.count, item.capacity);
      const w = fp.w * UNITS_PER_METER;
      const h = fp.h * UNITS_PER_METER;
      const d = fp.d * UNITS_PER_METER;
      _p.set(center.x, yBase + h * 0.5, center.z);
      _s.set(w, h, d);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(n, _m);
      slotToEntity[n] = id;
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  /** @param {number} instanceId @returns {number | null} */
  function entityFromInstanceId(instanceId) {
    return slotToEntity[instanceId] ?? null;
  }

  return { mesh, update, entityFromInstanceId };
}
