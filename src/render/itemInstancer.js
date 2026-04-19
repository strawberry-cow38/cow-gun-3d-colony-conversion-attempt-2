/**
 * Item render: one generic tinted-box InstancedMesh for all loose items, plus
 * three GLB-backed wood tiers that get selected per-stack based on fill
 * (1 log / 2 logs / 3-log triangle). Each wood tier may decompose into
 * multiple InstancedMeshes — glTF multi-material meshes import as a Group of
 * single-material Meshes, one per primitive, all sharing per-instance
 * transforms. Non-wood items stay on the box mesh; wood falls back to the
 * box only until the tier's GLB finishes loading.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { KIND_COLOR } from '../world/items.js';

const ITEM_SIZE = 0.35 * UNITS_PER_METER;
const MIN_HEIGHT_FRAC = 0.3;

// Post-import scale on top of UNITS_PER_METER so logs read at ground-item size.
const WOOD_EXTRA_SCALE = 1.5;
// Lifts wood GLBs so the lowest log rests on the tile (geometry is modelled
// centered about y=0 with log radius 0.11m, pre-scale).
const WOOD_Y_LIFT = 0.11 * UNITS_PER_METER * WOOD_EXTRA_SCALE;

const WOOD_TIER_URLS = ['models/wood.glb', 'models/wood_2.glb', 'models/wood_3.glb'];

const KIND_COLORS = /** @type {Record<string, THREE.Color>} */ (
  Object.fromEntries(Object.entries(KIND_COLOR).map(([k, hex]) => [k, new THREE.Color(hex)]))
);
const FALLBACK_COLOR = new THREE.Color(0xffffff);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _identityScale = new THREE.Vector3(1, 1, 1);

/**
 * @param {number} count
 * @param {number} capacity
 * @returns {0 | 1 | 2}
 */
function woodTier(count, capacity) {
  const frac = Math.min(1, count / Math.max(1, capacity));
  const t = Math.min(2, Math.floor(frac * 3));
  return /** @type {0 | 1 | 2} */ (t);
}

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createItemInstancer(scene, capacity = 1024) {
  const geo = new THREE.BoxGeometry(ITEM_SIZE, ITEM_SIZE, ITEM_SIZE);
  geo.translate(0, ITEM_SIZE * 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  scene.add(mesh);

  /** @type {Array<Array<THREE.InstancedMesh>>} per-tier list of primitive meshes */
  const woodMeshes = [[], [], []];

  const loader = new GLTFLoader();
  WOOD_TIER_URLS.forEach((url, tier) => {
    loader.load(url, (gltf) => {
      /** @type {THREE.InstancedMesh[]} */
      const primitives = [];
      gltf.scene.traverse((obj) => {
        const m = /** @type {THREE.Mesh} */ (/** @type {any} */ (obj));
        if (!m.isMesh || !m.geometry) return;
        const g = m.geometry.clone();
        const s = UNITS_PER_METER * WOOD_EXTRA_SCALE;
        g.scale(s, s, s);
        g.translate(0, WOOD_Y_LIFT, 0);
        // Clone the material so we can add a self-lit floor without mutating
        // the shared GLB material (bark + end-grain share textures across
        // tiers). The baked textures are mid-tone at best and read as near
        // black when shaded, so mirror the base map into emissive at low
        // intensity — the log stays grounded but doesn't crush to black.
        const srcMat = /** @type {THREE.MeshStandardMaterial} */ (m.material);
        const litMat = srcMat.clone();
        if (litMat.map) {
          litMat.emissiveMap = litMat.map;
          litMat.emissive = new THREE.Color(0xffffff);
          litMat.emissiveIntensity = 0.35;
          litMat.needsUpdate = true;
        }
        const im = new THREE.InstancedMesh(g, litMat, capacity);
        im.count = 0;
        im.castShadow = false;
        im.receiveShadow = true;
        scene.add(im);
        primitives.push(im);
      });
      if (primitives.length === 0) {
        console.warn(`[itemInstancer] ${url}: no mesh primitives`);
        return;
      }
      woodMeshes[tier] = primitives;
      dirty = true;
    });
  });

  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let boxI = 0;
    const woodI = [0, 0, 0];
    for (const { components } of world.query(['Item', 'TileAnchor', 'ItemViz'])) {
      const a = components.TileAnchor;
      const item = components.Item;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);

      if (item.kind === 'wood') {
        const tier = woodTier(item.count, item.capacity);
        const prims = woodMeshes[tier];
        if (prims.length > 0 && woodI[tier] < capacity) {
          _position.set(w.x, y, w.z);
          _matrix.compose(_position, _quat, _identityScale);
          for (const im of prims) im.setMatrixAt(woodI[tier], _matrix);
          woodI[tier]++;
          continue;
        }
      }

      if (boxI >= capacity) continue;
      const frac = Math.min(1, item.count / Math.max(1, item.capacity));
      _scale.set(1, MIN_HEIGHT_FRAC + (1 - MIN_HEIGHT_FRAC) * frac, 1);
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      mesh.setMatrixAt(boxI, _matrix);
      mesh.setColorAt(boxI, KIND_COLORS[item.kind] ?? FALLBACK_COLOR);
      boxI++;
    }
    mesh.count = boxI;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    for (let t = 0; t < 3; t++) {
      for (const im of woodMeshes[t]) {
        im.count = woodI[t];
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
      }
    }
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { mesh, update, markDirty };
}
