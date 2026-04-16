/**
 * Invisible click-hitbox InstancedMesh. One box per registered world object
 * (tree / boulder / wall / door / torch / roof / floor), sized by the same
 * `boxForEntity` helper that drives the ghost selection box — so the area
 * the player has to click matches the area that lights up.
 *
 * The mesh is hidden (`visible = false`), but three.js still raycasts it
 * when `intersectObject(mesh, false)` is called directly — the visibility
 * check only runs in recursive mode. That lets us keep the pick geometry
 * out of the draw path while still using three's raycaster.
 *
 * Rebuilt every render frame: growing trees, constructed walls, deleted
 * floors etc. all invalidate the boxes, and a few hundred matrix composes
 * per frame is cheap. A slot table maps instanceId → entity id.
 */

import * as THREE from 'three';
import { tileToWorld } from '../world/coords.js';
import { TRACKED_COMPONENTS, boxForEntity } from './objectBox.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createObjectHitboxes(scene, capacity) {
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
    for (const comp of TRACKED_COMPONENTS) {
      for (const { id, components } of world.query([comp, 'TileAnchor'])) {
        if (n >= capacity) break;
        const box = boxForEntity(world, id);
        if (!box) continue;
        const anchor = components.TileAnchor;
        const center = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
        const yBase = grid.getElevation(anchor.i, anchor.j) + box.yBase;
        _p.set(center.x, yBase + box.h * 0.5, center.z);
        _s.set(box.w, box.h, box.d);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(n, _m);
        slotToEntity[n] = id;
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** @param {number} instanceId @returns {number | null} */
  function entityFromInstanceId(instanceId) {
    return slotToEntity[instanceId] ?? null;
  }

  return { mesh, update, entityFromInstanceId };
}
