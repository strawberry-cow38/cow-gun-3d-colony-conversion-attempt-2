/**
 * Bush render: single InstancedMesh from bush.glb (crossed-quad billboard w/
 * alpha-cutout foliage texture baked from marlin shrub01). Per-instance yaw +
 * uniform scale pulled from BushViz so neighbours don't clone. Static rebuild
 * gated on `dirty`; no picking or markers — bushes are pure decor.
 *
 * Alpha is handled via MeshStandardMaterial.alphaTest (CLIP mode) so the
 * texture's feathered silhouette punches through cleanly without sort issues.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { createDropShadowInstancedMesh } from './dropShadow.js';

const BUSH_GLB_URL = 'models/bush.glb';
const BUSH_NODE_NAME = 'bush';
const SHADOW_RADIUS = 0.55 * UNITS_PER_METER;
const SHADOW_Y_OFFSET = 0.04 * UNITS_PER_METER;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _shadowScale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _identityQuat = new THREE.Quaternion();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createBushInstancer(scene, capacity = 2048) {
  /** @type {THREE.InstancedMesh | null} */
  let mesh = null;
  let dirty = true;

  const shadowMesh = createDropShadowInstancedMesh(scene, capacity, SHADOW_RADIUS, 0.38);

  new GLTFLoader().load(BUSH_GLB_URL, (gltf) => {
    const node = /** @type {THREE.Mesh | null} */ (gltf.scene.getObjectByName(BUSH_NODE_NAME));
    if (!node) {
      console.warn(`[bushInstancer] bush.glb missing node ${BUSH_NODE_NAME}`);
      return;
    }
    const geo = node.geometry.clone();
    geo.scale(UNITS_PER_METER, UNITS_PER_METER, UNITS_PER_METER);
    const mat = /** @type {THREE.MeshStandardMaterial} */ (node.material);
    // GLB's baked texture has alpha capped at 0.85. Keep the material in
    // transparent+alphaTest mode so the low-alpha silhouette edges clip (no
    // sort ghosting) while the interior renders at the baked 0.85 so light
    // visibly bleeds through the leaves.
    mat.transparent = true;
    mat.alphaTest = 0.3;
    mat.side = THREE.DoubleSide;
    mat.depthWrite = true;
    mat.needsUpdate = true;
    const im = new THREE.InstancedMesh(geo, mat, capacity);
    im.count = 0;
    im.castShadow = false;
    im.receiveShadow = true;
    scene.add(im);
    mesh = im;
    dirty = true;
  });

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    const m = mesh;
    let i = 0;
    for (const { components } of world.query(['Bush', 'TileAnchor', 'BushViz'])) {
      if (i >= capacity) break;
      const anchor = components.TileAnchor;
      const viz = components.BushViz;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      if (m) {
        _position.set(w.x, y, w.z);
        _euler.set(0, viz.yaw, 0);
        _quat.setFromEuler(_euler);
        _scale.set(viz.scale, viz.scale, viz.scale);
        _matrix.compose(_position, _quat, _scale);
        m.setMatrixAt(i, _matrix);
      }
      _position.set(w.x, y + SHADOW_Y_OFFSET, w.z);
      _shadowScale.set(viz.scale, 1, viz.scale);
      _matrix.compose(_position, _identityQuat, _shadowScale);
      shadowMesh.setMatrixAt(i, _matrix);
      i++;
    }
    if (m) {
      m.count = i;
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
    shadowMesh.count = i;
    shadowMesh.instanceMatrix.needsUpdate = true;
    shadowMesh.computeBoundingSphere();
    if (m) dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return {
    update,
    markDirty,
  };
}
