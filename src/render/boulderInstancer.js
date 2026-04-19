/**
 * Boulder render: six variant InstancedMeshes loaded from boulder.glb
 * (3 shapes × {regular, mossy}) plus a pickaxe-shaped floating marker
 * (handle + head) for marked boulders.
 *
 * Each GLB variant ships its own baked 512×512 diffuse texture (the
 * procedural stone / moss shader rendered into UV space) so per-pixel
 * detail survives export. Runtime uses the GLTF-provided materials as-is
 * and tints via setColorAt: stone = white (raw texture), copper/coal =
 * kind color multiplied over the stone texture to shift hue. Until
 * boulder.glb resolves, a procedural dodecahedron fallback renders so
 * the first frame isn't empty.
 *
 * Per-boulder yaw from BoulderViz.yaw so neighbours don't look like clones.
 * Static rebuild gated on `dirty`; marker rebuilt every frame (small count).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BOULDER_KINDS, BOULDER_VISUALS } from '../world/boulders.js';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { createDropShadowInstancedMesh } from './dropShadow.js';

const BOULDER_GLB_URL = 'models/boulder.glb';
const VARIANT_NAMES = ['boulder_a', 'boulder_b', 'boulder_c'];
const MOSSY_NAMES = ['boulder_a_mossy', 'boulder_b_mossy', 'boulder_c_mossy'];
// Stone textures already carry the final palette; tint white to show them
// raw. Copper/coal tint multiplies over the stone texture to shift hue.
const WHITE_TINT = new THREE.Color(0xffffff);

const FALLBACK_RADIUS = 0.55 * UNITS_PER_METER;
const FALLBACK_HEIGHT = 0.9 * UNITS_PER_METER;
const SHADOW_RADIUS = 0.6 * UNITS_PER_METER;
const SHADOW_Y_OFFSET = 0.04 * UNITS_PER_METER;

const MARKER_HANDLE_LENGTH = 0.55 * UNITS_PER_METER;
const MARKER_HANDLE_RADIUS = 0.05 * UNITS_PER_METER;
const MARKER_HEAD_WIDTH = 0.4 * UNITS_PER_METER;
const MARKER_HEAD_HEIGHT = 0.12 * UNITS_PER_METER;
const MARKER_HEAD_DEPTH = 0.08 * UNITS_PER_METER;
const MARKER_HOVER_BASE = FALLBACK_HEIGHT + 0.3 * UNITS_PER_METER;
const MARKER_BOB_AMP = 0.15 * UNITS_PER_METER;
const MARKER_BOB_FREQ_HZ = 1.4;
const MARKER_SPIN_RATE = 1.1;

/** @type {Map<string, { color: THREE.Color, scale: number[] }>} */
const BOULDER_DRAW = new Map();
for (const kind of BOULDER_KINDS) {
  const v = BOULDER_VISUALS[kind];
  if (!v) continue;
  BOULDER_DRAW.set(kind, { color: new THREE.Color(v.color), scale: v.scale });
}
const FALLBACK_DRAW = /** @type {NonNullable<ReturnType<typeof BOULDER_DRAW.get>>} */ (
  BOULDER_DRAW.get('stone') ?? BOULDER_DRAW.get(BOULDER_KINDS[0])
);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _shadowScale = new THREE.Vector3(1, 1, 1);
const _markerScale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _identityQuat = new THREE.Quaternion();

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createBoulderInstancer(scene, capacity = 4096) {
  const fallbackMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true,
  });

  const fallbackGeo = new THREE.DodecahedronGeometry(FALLBACK_RADIUS, 0);
  fallbackGeo.scale(1, FALLBACK_HEIGHT / (FALLBACK_RADIUS * 2), 1);
  fallbackGeo.translate(0, FALLBACK_HEIGHT * 0.5, 0);
  const fallbackMesh = new THREE.InstancedMesh(fallbackGeo, fallbackMat, capacity);
  fallbackMesh.count = 0;
  fallbackMesh.castShadow = true;
  fallbackMesh.receiveShadow = true;
  scene.add(fallbackMesh);

  const shadowMesh = createDropShadowInstancedMesh(scene, capacity, SHADOW_RADIUS, 0.4);

  /** @type {(THREE.InstancedMesh | null)[]} */
  const regularMeshes = [null, null, null];
  /** @type {(THREE.InstancedMesh | null)[]} */
  const mossyMeshes = [null, null, null];

  new GLTFLoader().load(BOULDER_GLB_URL, (gltf) => {
    for (let v = 0; v < 3; v++) {
      regularMeshes[v] = makeVariantMesh(scene, gltf, VARIANT_NAMES[v], capacity);
      mossyMeshes[v] = makeVariantMesh(scene, gltf, MOSSY_NAMES[v], capacity);
    }
    dirty = true;
  });

  const markerCap = Math.min(capacity, 256);
  const handleGeo = new THREE.CylinderGeometry(
    MARKER_HANDLE_RADIUS,
    MARKER_HANDLE_RADIUS,
    MARKER_HANDLE_LENGTH,
    6,
    1,
  );
  handleGeo.translate(0, MARKER_HANDLE_LENGTH * 0.5, 0);
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x6b3a1a, flatShading: true });
  const markerHandleMesh = new THREE.InstancedMesh(handleGeo, handleMat, markerCap);
  markerHandleMesh.count = 0;
  scene.add(markerHandleMesh);

  const headGeo = new THREE.BoxGeometry(MARKER_HEAD_WIDTH, MARKER_HEAD_HEIGHT, MARKER_HEAD_DEPTH);
  headGeo.translate(0, MARKER_HANDLE_LENGTH - MARKER_HEAD_HEIGHT * 0.2, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xc8ced6,
    metalness: 0.5,
    roughness: 0.35,
  });
  const markerHeadMesh = new THREE.InstancedMesh(headGeo, headMat, markerCap);
  markerHeadMesh.count = 0;
  scene.add(markerHeadMesh);

  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    const glbReady =
      regularMeshes[0] !== null && regularMeshes[1] !== null && regularMeshes[2] !== null;
    const counts = [0, 0, 0, 0, 0, 0]; // [reg0, reg1, reg2, moss0, moss1, moss2]
    let fallbackI = 0;
    let shadowI = 0;
    for (const { components } of world.query(['Boulder', 'TileAnchor', 'BoulderViz'])) {
      const anchor = components.TileAnchor;
      const boulder = components.Boulder;
      const viz = components.BoulderViz;
      const draw = BOULDER_DRAW.get(boulder.kind) ?? FALLBACK_DRAW;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      _position.set(w.x, y, w.z);
      _euler.set(0, viz.yaw, 0);
      _quat.setFromEuler(_euler);
      _scale.set(draw.scale[0], draw.scale[1], draw.scale[2]);
      _matrix.compose(_position, _quat, _scale);

      if (shadowI < capacity) {
        _position.set(w.x, y + SHADOW_Y_OFFSET, w.z);
        _shadowScale.set(draw.scale[0], 1, draw.scale[2]);
        _matrix.compose(_position, _identityQuat, _shadowScale);
        shadowMesh.setMatrixAt(shadowI, _matrix);
        shadowI++;
      }
      // recompose for the actual boulder mesh (shadow overwrote _matrix)
      _position.set(w.x, y, w.z);
      _scale.set(draw.scale[0], draw.scale[1], draw.scale[2]);
      _matrix.compose(_position, _quat, _scale);

      if (!glbReady) {
        if (fallbackI >= capacity) break;
        fallbackMesh.setMatrixAt(fallbackI, _matrix);
        fallbackMesh.setColorAt(fallbackI, draw.color);
        fallbackI++;
        continue;
      }
      const variantIdx = viz.variantIdx % 3;
      const useMossy = viz.mossy && boulder.kind === 'stone';
      const bucket = useMossy ? 3 + variantIdx : variantIdx;
      const mesh = useMossy ? mossyMeshes[variantIdx] : regularMeshes[variantIdx];
      if (!mesh) continue;
      const slot = counts[bucket];
      if (slot >= capacity) continue;
      mesh.setMatrixAt(slot, _matrix);
      const tint = boulder.kind === 'stone' ? WHITE_TINT : draw.color;
      mesh.setColorAt(slot, tint);
      counts[bucket] = slot + 1;
    }
    if (!glbReady) {
      commitMesh(fallbackMesh, fallbackI);
    } else {
      commitMesh(fallbackMesh, 0);
      for (let v = 0; v < 3; v++) {
        const reg = regularMeshes[v];
        const moss = mossyMeshes[v];
        if (reg) commitMesh(reg, counts[v]);
        if (moss) commitMesh(moss, counts[3 + v]);
      }
    }
    shadowMesh.count = shadowI;
    shadowMesh.instanceMatrix.needsUpdate = true;
    shadowMesh.computeBoundingSphere();
    dirty = false;
  }

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {number} timeSec
   */
  function updateMarkers(world, grid, timeSec) {
    const bob = MARKER_BOB_AMP * Math.sin(timeSec * MARKER_BOB_FREQ_HZ * Math.PI * 2);
    const yaw = timeSec * MARKER_SPIN_RATE;
    _euler.set(0, yaw, 0);
    _quat.setFromEuler(_euler);
    _markerScale.set(1, 1, 1);
    let i = 0;
    for (const { components } of world.query(['Boulder', 'TileAnchor', 'BoulderViz'])) {
      const boulder = components.Boulder;
      if (boulder.markedJobId <= 0) continue;
      if (i >= markerCap) break;
      const anchor = components.TileAnchor;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      _position.set(w.x, y + MARKER_HOVER_BASE + bob, w.z);
      _matrix.compose(_position, _quat, _markerScale);
      markerHandleMesh.setMatrixAt(i, _matrix);
      markerHeadMesh.setMatrixAt(i, _matrix);
      i++;
    }
    markerHandleMesh.count = i;
    markerHeadMesh.count = i;
    markerHandleMesh.instanceMatrix.needsUpdate = true;
    markerHeadMesh.instanceMatrix.needsUpdate = true;
    markerHandleMesh.computeBoundingSphere();
    markerHeadMesh.computeBoundingSphere();
  }

  function markDirty() {
    dirty = true;
  }

  return {
    update,
    updateMarkers,
    markDirty,
  };
}

/**
 * @param {THREE.InstancedMesh} mesh
 * @param {number} count
 */
function commitMesh(mesh, count) {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/**
 * Reuse the GLB mesh's own material (which carries the baked texture) rather
 * than a shared plain material — that's the whole point of baking. Disable
 * flatShading on it so the UV-space noise detail doesn't fight per-face
 * lighting breaks.
 *
 * @param {THREE.Scene} scene
 * @param {import('three/examples/jsm/loaders/GLTFLoader.js').GLTF} gltf
 * @param {string} nodeName
 * @param {number} capacity
 */
function makeVariantMesh(scene, gltf, nodeName, capacity) {
  const node = /** @type {THREE.Mesh | null} */ (gltf.scene.getObjectByName(nodeName));
  if (!node) {
    console.warn(`[boulderInstancer] boulder.glb missing node ${nodeName}`);
    return null;
  }
  const geo = node.geometry.clone();
  geo.scale(UNITS_PER_METER, UNITS_PER_METER, UNITS_PER_METER);
  const mat = /** @type {THREE.MeshStandardMaterial} */ (node.material);
  const im = new THREE.InstancedMesh(geo, mat, capacity);
  im.count = 0;
  im.castShadow = true;
  im.receiveShadow = true;
  scene.add(im);
  return im;
}
