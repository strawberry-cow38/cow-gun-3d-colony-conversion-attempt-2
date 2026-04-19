/**
 * Bed renderer. Loads a baked two-tile bed.glb (mattress, frame, headboard,
 * footboard, pillow, blanket) and draws each primitive as its own
 * InstancedMesh, sharing per-bed transforms.
 *
 * GLB orientation: length along local +Z with the head at +Z, width along X,
 * height along Y. Matches the placement convention used by the procedural
 * ghost/instancer it replaces — the bed's head points along the facing
 * direction (FACING_YAWS[0] = 0 rotates local +Z to world +Z).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { FACING_OFFSETS, FACING_YAWS } from '../world/facing.js';

/** Full bed dimensions — the glb spans exactly two tiles along its length. */
export const BED_LENGTH = TILE_SIZE * 2;
export const BED_WIDTH = TILE_SIZE * 0.8;
export const BED_HEIGHT = 0.35 * UNITS_PER_METER;
export const BED_HEADBOARD_HEIGHT = 0.75 * UNITS_PER_METER;
export const BED_HEADBOARD_THICKNESS = TILE_SIZE * 0.18;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _identityScale = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);

/** @type {Promise<THREE.Group> | null} */
let _glbPromise = null;
function loadBedGlb() {
  if (_glbPromise) return _glbPromise;
  const loader = new GLTFLoader();
  _glbPromise = new Promise((resolve, reject) => {
    loader.load(
      'models/bed.glb',
      (gltf) => resolve(gltf.scene),
      undefined,
      (err) => reject(err),
    );
  });
  return _glbPromise;
}

/**
 * Flatten a loaded GLB into bake-ready primitives. Each mesh's world matrix
 * is baked into its geometry so per-bed transforms only need position+yaw.
 *
 * @param {THREE.Group} root
 * @returns {Array<{ geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial }>}
 */
function bakePrimitives(root) {
  root.updateMatrixWorld(true);
  const s = UNITS_PER_METER;
  const scaleMat = new THREE.Matrix4().makeScale(s, s, s);
  /** @type {Array<{ geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial }>} */
  const primitives = [];
  root.traverse((obj) => {
    const m = /** @type {THREE.Mesh} */ (/** @type {any} */ (obj));
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    g.applyMatrix4(scaleMat);
    const srcMat = /** @type {THREE.MeshStandardMaterial} */ (m.material);
    const mat = srcMat.clone();
    mat.needsUpdate = true;
    primitives.push({ geometry: g, material: mat });
  });
  return primitives;
}

/**
 * @param {THREE.Scene} scene
 * @param {number} [capacity]
 */
export function createBedInstancer(scene, capacity = 64) {
  /** @type {THREE.InstancedMesh[]} */
  const meshes = [];
  let loaded = false;
  let dirty = true;

  loadBedGlb().then((root) => {
    for (const { geometry, material } of bakePrimitives(root)) {
      const im = new THREE.InstancedMesh(geometry, material, capacity);
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      scene.add(im);
      meshes.push(im);
    }
    loaded = true;
    dirty = true;
  });

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!loaded || !dirty) return;
    let i = 0;
    for (const { components } of world.query(['Bed', 'TileAnchor', 'BedViz'])) {
      if (i >= capacity) break;
      const a = components.TileAnchor;
      const facing = components.Bed.facing | 0;
      const off = FACING_OFFSETS[facing] ?? FACING_OFFSETS[0];
      const anchorWorld = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      // Bed center sits between anchor and forward tile; head end points along
      // the facing direction, which yaw-rotates local +Z to world +facing.
      const cx = anchorWorld.x + off.di * (TILE_SIZE / 2);
      const cz = anchorWorld.z + off.dj * (TILE_SIZE / 2);
      const yaw = FACING_YAWS[facing] ?? 0;
      _quat.setFromAxisAngle(_yAxis, yaw);
      _position.set(cx, y, cz);
      _matrix.compose(_position, _quat, _identityScale);
      for (const im of meshes) im.setMatrixAt(i, _matrix);
      i++;
    }
    for (const im of meshes) {
      im.count = i;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { update, markDirty };
}

/**
 * Ghost (build-preview) silhouette for bed placement. Same GLB, semi-transparent
 * so it reads as a preview. Group origin is the anchor tile; geometry is
 * pre-shifted forward half a tile so the bed's center lands at the midpoint
 * between anchor and forward tile.
 *
 * @param {THREE.Scene} scene
 */
export function createBedGhost(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  loadBedGlb().then((root) => {
    for (const { geometry, material } of bakePrimitives(root)) {
      geometry.translate(0, 0, TILE_SIZE * 0.5);
      const mat = material.clone();
      mat.transparent = true;
      mat.opacity = 0.35;
      mat.depthWrite = false;
      const mesh = new THREE.Mesh(geometry, mat);
      group.add(mesh);
    }
  });

  return { group };
}
