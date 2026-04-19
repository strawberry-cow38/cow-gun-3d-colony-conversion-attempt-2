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

const BUSH_GLB_URL = 'models/bush.glb';
const BUSH_NODE_NAME = 'bush';

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createBushInstancer(scene, capacity = 2048) {
  /** @type {THREE.InstancedMesh | null} */
  let mesh = null;
  let dirty = true;

  new GLTFLoader().load(BUSH_GLB_URL, (gltf) => {
    const node = /** @type {THREE.Mesh | null} */ (gltf.scene.getObjectByName(BUSH_NODE_NAME));
    if (!node) {
      console.warn(`[bushInstancer] bush.glb missing node ${BUSH_NODE_NAME}`);
      return;
    }
    const geo = node.geometry.clone();
    geo.scale(UNITS_PER_METER, UNITS_PER_METER, UNITS_PER_METER);
    const mat = /** @type {THREE.MeshStandardMaterial} */ (node.material);
    // GLB's own material carries the baked alpha texture. Force alphaTest so
    // three treats it as alpha-cut (no sort-order ghosting) regardless of the
    // transparent flag the exporter wrote.
    mat.transparent = false;
    mat.alphaTest = 0.5;
    mat.side = THREE.DoubleSide;
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
    if (!m) return;
    let i = 0;
    for (const { components } of world.query(['Bush', 'TileAnchor', 'BushViz'])) {
      if (i >= capacity) break;
      const anchor = components.TileAnchor;
      const viz = components.BushViz;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      _position.set(w.x, y, w.z);
      _euler.set(0, viz.yaw, 0);
      _quat.setFromEuler(_euler);
      _scale.set(viz.scale, viz.scale, viz.scale);
      _matrix.compose(_position, _quat, _scale);
      m.setMatrixAt(i, _matrix);
      i++;
    }
    m.count = i;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return {
    update,
    markDirty,
  };
}
