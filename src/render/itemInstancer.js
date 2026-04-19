/**
 * Item render: one generic tinted-box InstancedMesh for all loose items, plus
 * per-kind GLB-backed tiers that get selected per-stack based on fill (1 / 2 /
 * 3-item piles). Each tier may decompose into multiple InstancedMeshes —
 * glTF multi-material meshes import as a Group of single-material Meshes, one
 * per primitive, all sharing per-instance transforms. Non-tiered items stay
 * on the box mesh; tiered kinds fall back to the box until their GLB loads.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { KIND_COLOR } from '../world/items.js';

const ITEM_SIZE = 0.35 * UNITS_PER_METER;
const MIN_HEIGHT_FRAC = 0.3;

// Per-kind tiered-GLB config. Wood logs are modelled centered about y=0 with
// log radius 0.11m (pre-scale), so we lift to rest the lowest log on the tile.
// Stones are modelled with their base already at y=0 (bmesh shifted so min-z=0),
// so no extra lift is needed.
const TIERED_KINDS = /** @type {const} */ ({
  wood: {
    urls: ['models/wood.glb', 'models/wood_2.glb', 'models/wood_3.glb'],
    extraScale: 1.5,
    yLift: 0.11 * UNITS_PER_METER * 1.5,
  },
  stone: {
    urls: ['models/stone.glb', 'models/stone_2.glb', 'models/stone_3.glb'],
    extraScale: 1.0,
    yLift: 0,
  },
});

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
function pileTier(count, capacity) {
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

  /** @type {Record<string, Array<Array<THREE.InstancedMesh>>>} kind -> tier -> primitives */
  const tieredMeshes = {};
  for (const kind of Object.keys(TIERED_KINDS)) tieredMeshes[kind] = [[], [], []];

  const loader = new GLTFLoader();
  for (const [kind, cfg] of Object.entries(TIERED_KINDS)) {
    cfg.urls.forEach((url, tier) => {
      loader.load(url, (gltf) => {
        /** @type {THREE.InstancedMesh[]} */
        const primitives = [];
        gltf.scene.traverse((obj) => {
          const m = /** @type {THREE.Mesh} */ (/** @type {any} */ (obj));
          if (!m.isMesh || !m.geometry) return;
          const g = m.geometry.clone();
          const s = UNITS_PER_METER * cfg.extraScale;
          g.scale(s, s, s);
          if (cfg.yLift) g.translate(0, cfg.yLift, 0);
          const srcMat = /** @type {THREE.MeshStandardMaterial} */ (m.material);
          const litMat = srcMat.clone();
          // Wood bark reads too dark at game scale; lift via diffuse tint >1
          // (linear-space multiplier on the baked map, no emissive glow).
          if (kind === 'wood') litMat.color.setRGB(1.5, 1.5, 1.5);
          litMat.needsUpdate = true;
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
        tieredMeshes[kind][tier] = primitives;
        dirty = true;
      });
    });
  }

  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let boxI = 0;
    /** @type {Record<string, [number, number, number]>} kind -> per-tier slot counts */
    const tierSlots = {};
    for (const kind of Object.keys(TIERED_KINDS)) tierSlots[kind] = [0, 0, 0];
    for (const { components } of world.query(['Item', 'TileAnchor', 'ItemViz'])) {
      const a = components.TileAnchor;
      const item = components.Item;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);

      const tierCfg = TIERED_KINDS[/** @type {keyof typeof TIERED_KINDS} */ (item.kind)];
      if (tierCfg) {
        const tier = pileTier(item.count, item.capacity);
        const prims = tieredMeshes[item.kind][tier];
        const slot = tierSlots[item.kind][tier];
        if (prims.length > 0 && slot < capacity) {
          _position.set(w.x, y, w.z);
          _matrix.compose(_position, _quat, _identityScale);
          for (const im of prims) im.setMatrixAt(slot, _matrix);
          tierSlots[item.kind][tier] = slot + 1;
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
    for (const kind of Object.keys(TIERED_KINDS)) {
      for (let t = 0; t < 3; t++) {
        for (const im of tieredMeshes[kind][t]) {
          im.count = tierSlots[kind][t];
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
        }
      }
    }
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { mesh, update, markDirty };
}
