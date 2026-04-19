/**
 * Item render: one generic tinted-box InstancedMesh for all loose items, plus
 * three GLB-backed wood meshes that get selected per-stack based on fill tier
 * (1 log / 2 logs / 3-log triangle). Non-wood items stay on the box mesh;
 * wood falls back to the box mesh only until its tier's GLB finishes loading.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { KIND_COLOR } from '../world/items.js';

const ITEM_SIZE = 0.35 * UNITS_PER_METER;
const MIN_HEIGHT_FRAC = 0.3;

// Lifts wood GLBs so the lowest log rests on the tile (geometry is modelled
// centered about y=0 with log radius 0.11m).
const WOOD_Y_LIFT = 0.11 * UNITS_PER_METER;

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

  /** @type {Array<THREE.InstancedMesh | null>} */
  const woodMeshes = [null, null, null];

  const loader = new GLTFLoader();
  WOOD_TIER_URLS.forEach((url, tier) => {
    loader.load(url, (gltf) => {
      /** @type {THREE.Mesh | null} */
      const node = /** @type {any} */ (gltf.scene.getObjectByName('wood'));
      if (!node) {
        console.warn(`[itemInstancer] ${url} missing "wood" node`);
        return;
      }
      const g = node.geometry.clone();
      g.scale(UNITS_PER_METER, UNITS_PER_METER, UNITS_PER_METER);
      g.translate(0, WOOD_Y_LIFT, 0);
      const im = new THREE.InstancedMesh(g, node.material, capacity);
      im.count = 0;
      im.castShadow = false;
      im.receiveShadow = true;
      scene.add(im);
      woodMeshes[tier] = im;
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
        const im = woodMeshes[tier];
        if (im && woodI[tier] < capacity) {
          _position.set(w.x, y, w.z);
          _matrix.compose(_position, _quat, _identityScale);
          im.setMatrixAt(woodI[tier], _matrix);
          woodI[tier]++;
          continue;
        }
        // GLB still loading — fall through to tinted box.
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
      const im = woodMeshes[t];
      if (!im) continue;
      im.count = woodI[t];
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { mesh, update, markDirty };
}
