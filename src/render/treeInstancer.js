/**
 * Tree render: two InstancedMeshes (trunk + canopy), two draw calls total.
 * Trees are static — positions come from TileAnchor once at spawn time and
 * never change, so the instance matrices are written on demand (whenever
 * spawn/despawn happens) rather than every frame.
 *
 * A top-level `dirty` flag is flipped by the tree system on spawn/despawn;
 * the instancer rebuilds its matrices lazily on the next frame.
 *
 * `pickFromInstanceId` maps a trunk/canopy raycast hit back to the tree
 * entity behind that slot so the designator can mark it for chop.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const TRUNK_HEIGHT = 2.2 * UNITS_PER_METER;
const TRUNK_RADIUS = 0.18 * UNITS_PER_METER;
const CANOPY_RADIUS = 0.9 * UNITS_PER_METER;
const CANOPY_HEIGHT = 1.6 * UNITS_PER_METER;
const MARKED_TINT = new THREE.Color(0xff5a3a);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _baseColor = new THREE.Color();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createTreeInstancer(scene, capacity = 2048) {
  const trunkGeo = new THREE.CylinderGeometry(
    TRUNK_RADIUS * 0.75,
    TRUNK_RADIUS,
    TRUNK_HEIGHT,
    6,
    1,
  );
  trunkGeo.translate(0, TRUNK_HEIGHT * 0.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3820, flatShading: true });
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, capacity);
  trunkMesh.count = 0;
  trunkMesh.frustumCulled = false;
  scene.add(trunkMesh);

  const canopyGeo = new THREE.ConeGeometry(CANOPY_RADIUS, CANOPY_HEIGHT, 7, 1);
  canopyGeo.translate(0, TRUNK_HEIGHT + CANOPY_HEIGHT * 0.5, 0);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2e6f3a, flatShading: true });
  const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, capacity);
  canopyMesh.count = 0;
  canopyMesh.frustumCulled = false;
  scene.add(canopyMesh);

  /** @type {number[]} slot → entity id */
  const slotToEntity = [];
  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let i = 0;
    slotToEntity.length = 0;
    for (const { id, components } of world.query(['Tree', 'TileAnchor', 'TreeViz'])) {
      if (i >= capacity) break;
      const anchor = components.TileAnchor;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      trunkMesh.setMatrixAt(i, _matrix);
      canopyMesh.setMatrixAt(i, _matrix);

      if (components.Tree.markedJobId > 0) {
        _baseColor.copy(MARKED_TINT);
      } else {
        _baseColor.setRGB(1, 1, 1);
      }
      canopyMesh.setColorAt(i, _baseColor);

      slotToEntity[i] = id;
      i++;
    }
    trunkMesh.count = i;
    canopyMesh.count = i;
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  /** @param {number} instanceId */
  function entityFromInstanceId(instanceId) {
    return slotToEntity[instanceId] ?? null;
  }

  return {
    trunkMesh,
    canopyMesh,
    update,
    markDirty,
    entityFromInstanceId,
  };
}
