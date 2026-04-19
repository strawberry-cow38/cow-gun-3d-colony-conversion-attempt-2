/**
 * Boulder render: twelve variant InstancedMeshes loaded from boulder.glb
 * (3 shapes × {regular, mossy, copper, coal}) plus a pickaxe-shaped
 * floating marker (handle + head) for marked boulders.
 *
 * Each GLB variant ships its own baked 512×512 diffuse texture (the
 * procedural stone / moss shader rendered into UV space) so per-pixel
 * detail survives export. Copper + coal variants are two-primitive meshes
 * (stone base + embedded ore chunks w/ vertex-colored palettes), so they
 * come through GLTFLoader as Group → Mesh[]. Runtime uses the GLTF-provided
 * materials as-is and tints via setColorAt: stone = white, copper = warm
 * off-white, coal = cool darker off-white. Until boulder.glb resolves, a
 * procedural dodecahedron fallback renders so the first frame isn't empty.
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
const COPPER_NAMES = ['boulder_a_copper', 'boulder_b_copper', 'boulder_c_copper'];
const COAL_NAMES = ['boulder_a_coal', 'boulder_b_coal', 'boulder_c_coal'];
// Stone texture carries its final palette; tint white to show it raw.
// Copper gets a soft warm off-white so ore nodes read as "copper" at a
// glance; coal gets a cool darker off-white so the stone base reads as
// sootier than plain rock without crushing the baked pixel detail.
const WHITE_TINT = new THREE.Color(0xffffff);
const COPPER_TINT = new THREE.Color(0xffd0a8);
const COAL_TINT = new THREE.Color(0x9a9aa0);

const FALLBACK_RADIUS = 0.55 * UNITS_PER_METER;
const FALLBACK_HEIGHT = 0.9 * UNITS_PER_METER;
const SHADOW_RADIUS = 1.2 * UNITS_PER_METER;
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

  const shadowMesh = createDropShadowInstancedMesh(scene, capacity, SHADOW_RADIUS, 0.62);

  // Each entry is null until the GLB resolves, then an array of 1+ InstancedMesh
  // — one per primitive of the GLB node. Copper nodes export as two primitives
  // (stone base + ore chunks, split on material_index), so they come through
  // as Group → Mesh[], not a single Mesh.
  /** @type {(THREE.InstancedMesh[] | null)[]} */
  const regularMeshes = [null, null, null];
  /** @type {(THREE.InstancedMesh[] | null)[]} */
  const mossyMeshes = [null, null, null];
  /** @type {(THREE.InstancedMesh[] | null)[]} */
  const copperMeshes = [null, null, null];
  /** @type {(THREE.InstancedMesh[] | null)[]} */
  const coalMeshes = [null, null, null];

  new GLTFLoader().load(BOULDER_GLB_URL, (gltf) => {
    for (let v = 0; v < 3; v++) {
      regularMeshes[v] = makeVariantMesh(scene, gltf, VARIANT_NAMES[v], capacity);
      mossyMeshes[v] = makeVariantMesh(scene, gltf, MOSSY_NAMES[v], capacity);
      copperMeshes[v] = makeVariantMesh(scene, gltf, COPPER_NAMES[v], capacity);
      coalMeshes[v] = makeVariantMesh(scene, gltf, COAL_NAMES[v], capacity);
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
    // [reg0..2, moss0..2, copper0..2, coal0..2]
    const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
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
      const useCopper = boulder.kind === 'copper';
      const useCoal = boulder.kind === 'coal';
      const useMossy = viz.mossy && boulder.kind === 'stone';
      let bucket;
      let parts;
      if (useCopper) {
        bucket = 6 + variantIdx;
        parts = copperMeshes[variantIdx];
      } else if (useCoal) {
        bucket = 9 + variantIdx;
        parts = coalMeshes[variantIdx];
      } else if (useMossy) {
        bucket = 3 + variantIdx;
        parts = mossyMeshes[variantIdx];
      } else {
        bucket = variantIdx;
        parts = regularMeshes[variantIdx];
      }
      if (!parts) continue;
      const slot = counts[bucket];
      if (slot >= capacity) continue;
      // Stone carries its final palette raw; ore variants tint the baked
      // material: copper warmer + brighter, coal cooler + darker.
      const tint = useCopper ? COPPER_TINT : useCoal ? COAL_TINT : WHITE_TINT;
      for (const part of parts) {
        part.setMatrixAt(slot, _matrix);
        part.setColorAt(slot, tint);
      }
      counts[bucket] = slot + 1;
    }
    if (!glbReady) {
      commitMesh(fallbackMesh, fallbackI);
    } else {
      commitMesh(fallbackMesh, 0);
      for (let v = 0; v < 3; v++) {
        commitParts(regularMeshes[v], counts[v]);
        commitParts(mossyMeshes[v], counts[3 + v]);
        commitParts(copperMeshes[v], counts[6 + v]);
        commitParts(coalMeshes[v], counts[9 + v]);
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
 * @param {THREE.InstancedMesh[] | null} parts
 * @param {number} count
 */
function commitParts(parts, count) {
  if (!parts) return;
  for (const p of parts) commitMesh(p, count);
}

/**
 * Reuse each GLB primitive's own material (which carries the baked texture)
 * rather than a shared plain material — that's the whole point of baking.
 * Multi-primitive nodes (like copper: stone base + ore chunks) come through
 * GLTFLoader as a Group, so walk any Mesh children and build one
 * InstancedMesh per primitive. Caller renders every part at the same matrix.
 *
 * @param {THREE.Scene} scene
 * @param {import('three/examples/jsm/loaders/GLTFLoader.js').GLTF} gltf
 * @param {string} nodeName
 * @param {number} capacity
 */
function makeVariantMesh(scene, gltf, nodeName, capacity) {
  const node = gltf.scene.getObjectByName(nodeName);
  if (!node) {
    console.warn(`[boulderInstancer] boulder.glb missing node ${nodeName}`);
    return null;
  }
  /** @type {THREE.Mesh[]} */
  const meshes = [];
  node.traverse((o) => {
    if (/** @type {THREE.Mesh} */ (o).isMesh) meshes.push(/** @type {THREE.Mesh} */ (o));
  });
  if (meshes.length === 0) {
    console.warn(`[boulderInstancer] boulder.glb node ${nodeName} has no mesh primitives`);
    return null;
  }
  const parts = [];
  for (const m of meshes) {
    const geo = /** @type {THREE.BufferGeometry} */ (m.geometry).clone();
    geo.scale(UNITS_PER_METER, UNITS_PER_METER, UNITS_PER_METER);
    const mat = /** @type {THREE.MeshStandardMaterial} */ (m.material);
    const im = new THREE.InstancedMesh(geo, mat, capacity);
    im.count = 0;
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
    parts.push(im);
  }
  return parts;
}
