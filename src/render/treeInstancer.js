/**
 * Tree render: two InstancedMeshes (trunk + canopy), plus two more for the
 * chop-designation marker (handle + head of a floating axe icon) that only
 * render for trees with Tree.markedJobId > 0.
 *
 * Per-instance trunk+canopy color comes from TREE_VISUALS[kind]; per-instance
 * scale combines kind-specific proportions with the tree's `growth` 0..1 (see
 * growthScale in trees.js). Trunk + canopy matrices rebuild only when the
 * top-level `dirty` flag is flipped — spawn, despawn, growth tick, or chop.
 * The axe marker bobs every frame, so its matrices are rebuilt in
 * `updateMarkers(world, grid, timeSec)` which is cheap: there are only ever
 * a handful of marked trees at once.
 *
 * `entityFromInstanceId` maps a trunk/canopy raycast hit back to the tree
 * entity behind that slot so the designator can mark it for chop.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { TREE_KINDS, TREE_VISUALS, growthScale } from '../world/trees.js';
import { createDropShadowInstancedMesh } from './dropShadow.js';

const PINE_GLB_URL = 'models/pine.glb';
const MAPLE_GLB_URL = 'models/maple.glb';
// Authored Z of the canopy's base in the GLB. We pre-translate the canopy geo
// down by this so its base sits at y=0 in mesh space — matches the cone canopy
// convention, which lets update() position the canopy by the trunk top without
// the offset getting stretched by per-instance scaleY.
const PINE_CANOPY_BASE_Z = 1.05;
const MAPLE_CANOPY_BASE_Z = 1.98;

const TRUNK_HEIGHT = 2.2 * UNITS_PER_METER;
const TRUNK_RADIUS = 0.18 * UNITS_PER_METER;
const CANOPY_RADIUS = 0.9 * UNITS_PER_METER;
const CANOPY_HEIGHT = 1.6 * UNITS_PER_METER;
const SPHERE_CANOPY_RADIUS = 0.9 * UNITS_PER_METER;

const MARKER_HANDLE_LENGTH = 0.55 * UNITS_PER_METER;
const MARKER_HANDLE_RADIUS = 0.05 * UNITS_PER_METER;
const MARKER_HEAD_WIDTH = 0.35 * UNITS_PER_METER;
const MARKER_HEAD_HEIGHT = 0.18 * UNITS_PER_METER;
const MARKER_HEAD_DEPTH = 0.08 * UNITS_PER_METER;
const MARKER_HOVER_BASE = TRUNK_HEIGHT + CANOPY_HEIGHT + 0.3 * UNITS_PER_METER;
const MARKER_BOB_AMP = 0.15 * UNITS_PER_METER;
const MARKER_BOB_FREQ_HZ = 1.4;
const MARKER_SPIN_RATE = 1.1; // rad/sec

const SHADOW_RADIUS = 0.95 * UNITS_PER_METER;
const SHADOW_Y_OFFSET = 0.04 * UNITS_PER_METER;

// Pre-bake per-kind THREE.Color instances so setColorAt doesn't re-unpack a
// hex int on every instance write. Oak doubles as the fallback for unknown
// kinds (legacy saves default to oak too).
/** @type {Map<string, { trunk: THREE.Color, canopy: THREE.Color, trunkScale: number[], canopyScale: number[], canopyShape: 'cone' | 'sphere' }>} */
const TREE_DRAW = new Map();
for (const kind of TREE_KINDS) {
  const v = TREE_VISUALS[kind];
  if (!v) continue;
  TREE_DRAW.set(kind, {
    trunk: new THREE.Color(v.trunkColor),
    canopy: new THREE.Color(v.canopyColor),
    trunkScale: v.trunkScale,
    canopyScale: v.canopyScale,
    canopyShape: v.canopyShape,
  });
}
const FALLBACK_DRAW = /** @type {NonNullable<ReturnType<typeof TREE_DRAW.get>>} */ (
  TREE_DRAW.get('oak') ?? TREE_DRAW.get(TREE_KINDS[0])
);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _trunkScale = new THREE.Vector3(1, 1, 1);
const _canopyScale = new THREE.Vector3(1, 1, 1);
const _markerScale = new THREE.Vector3(1, 1, 1);
const _shadowScale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _identityQuat = new THREE.Quaternion();

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
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, capacity);
  trunkMesh.count = 0;
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  scene.add(trunkMesh);

  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });

  // Canopy geos are anchored at their own base (y=0) so update() can position
  // the canopy's base exactly at the (kind-scaled) trunk top without the
  // translate being stretched by instance scaleY.
  const canopyConeGeo = new THREE.ConeGeometry(CANOPY_RADIUS, CANOPY_HEIGHT, 7, 1);
  canopyConeGeo.translate(0, CANOPY_HEIGHT * 0.5, 0);
  const canopyConeMesh = new THREE.InstancedMesh(canopyConeGeo, canopyMat, capacity);
  canopyConeMesh.count = 0;
  canopyConeMesh.castShadow = true;
  canopyConeMesh.receiveShadow = true;
  scene.add(canopyConeMesh);

  const canopySphereGeo = new THREE.SphereGeometry(SPHERE_CANOPY_RADIUS, 8, 6);
  canopySphereGeo.translate(0, SPHERE_CANOPY_RADIUS, 0);
  const canopySphereMesh = new THREE.InstancedMesh(canopySphereGeo, canopyMat, capacity);
  canopySphereMesh.count = 0;
  canopySphereMesh.castShadow = true;
  canopySphereMesh.receiveShadow = true;
  scene.add(canopySphereMesh);

  const shadowMesh = createDropShadowInstancedMesh(scene, capacity, SHADOW_RADIUS, 0.62);

  // Species-specific GLB renders. Loaded async — until ready, trees of that
  // kind fall through to the procedural path for the frame.
  /** @type {THREE.InstancedMesh | null} */
  let pineTrunkMesh = null;
  /** @type {THREE.InstancedMesh | null} */
  let pineCanopyMesh = null;
  /** @type {THREE.InstancedMesh | null} */
  let mapleTrunkMesh = null;
  /** @type {THREE.InstancedMesh | null} */
  let mapleCanopyMesh = null;

  /**
   * @param {string} url
   * @param {string} trunkNodeName
   * @param {string} canopyNodeName
   * @param {number} canopyBaseZ
   * @param {(trunk: THREE.InstancedMesh, canopy: THREE.InstancedMesh) => void} onReady
   */
  function loadSpeciesGlb(url, trunkNodeName, canopyNodeName, canopyBaseZ, onReady) {
    new GLTFLoader().load(url, (gltf) => {
      const trunkNode = /** @type {THREE.Mesh | null} */ (
        gltf.scene.getObjectByName(trunkNodeName)
      );
      const canopyNode = /** @type {THREE.Mesh | null} */ (
        gltf.scene.getObjectByName(canopyNodeName)
      );
      if (!trunkNode || !canopyNode) {
        console.warn(`[treeInstancer] ${url} missing ${trunkNodeName} or ${canopyNodeName} node`);
        return;
      }
      const trunkGlbGeo = trunkNode.geometry.clone();
      const canopyGlbGeo = canopyNode.geometry.clone();
      trunkGlbGeo.scale(UNITS_PER_METER, UNITS_PER_METER, UNITS_PER_METER);
      canopyGlbGeo.scale(UNITS_PER_METER, UNITS_PER_METER, UNITS_PER_METER);
      canopyGlbGeo.translate(0, -canopyBaseZ * UNITS_PER_METER, 0);
      const trunkIm = new THREE.InstancedMesh(trunkGlbGeo, trunkMat, capacity);
      trunkIm.count = 0;
      trunkIm.castShadow = true;
      trunkIm.receiveShadow = true;
      scene.add(trunkIm);
      const canopyIm = new THREE.InstancedMesh(canopyGlbGeo, canopyMat, capacity);
      canopyIm.count = 0;
      canopyIm.castShadow = true;
      canopyIm.receiveShadow = true;
      scene.add(canopyIm);
      onReady(trunkIm, canopyIm);
      dirty = true;
    });
  }

  loadSpeciesGlb(PINE_GLB_URL, 'Pine_Trunk', 'Pine_Canopy', PINE_CANOPY_BASE_Z, (t, c) => {
    pineTrunkMesh = t;
    pineCanopyMesh = c;
  });
  loadSpeciesGlb(MAPLE_GLB_URL, 'Maple_Trunk', 'Maple_Canopy', MAPLE_CANOPY_BASE_Z, (t, c) => {
    mapleTrunkMesh = t;
    mapleCanopyMesh = c;
  });

  // Axe marker. Handle offset so the grip sits at y=0 and the head at the top.
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
  headGeo.translate(MARKER_HEAD_WIDTH * 0.3, MARKER_HANDLE_LENGTH - MARKER_HEAD_HEIGHT * 0.2, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xc8ced6,
    metalness: 0.5,
    roughness: 0.35,
  });
  const markerHeadMesh = new THREE.InstancedMesh(headGeo, headMat, markerCap);
  markerHeadMesh.count = 0;
  scene.add(markerHeadMesh);

  /** @type {number[]} trunkMesh (procedural species) slot → entity id */
  const slotToEntity = [];
  /** @type {number[]} pineTrunkMesh slot → entity id */
  const pineSlotToEntity = [];
  /** @type {number[]} mapleTrunkMesh slot → entity id */
  const mapleSlotToEntity = [];
  let dirty = true;

  /**
   * Flush staged instance writes: set count, mark matrix/color dirty for GPU,
   * recompute bounding sphere for frustum culling.
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
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let iTrunk = 0;
    let iCone = 0;
    let iSphere = 0;
    let iPine = 0;
    let iMaple = 0;
    let iShadow = 0;
    slotToEntity.length = 0;
    pineSlotToEntity.length = 0;
    mapleSlotToEntity.length = 0;
    // _quat is shared with updateMarkers which spins it — reset to identity
    // so static trees render upright regardless of frame order.
    _quat.identity();
    const pineTrunk = pineTrunkMesh;
    const pineCanopy = pineCanopyMesh;
    const pineReady = pineTrunk !== null && pineCanopy !== null;
    const mapleTrunk = mapleTrunkMesh;
    const mapleCanopy = mapleCanopyMesh;
    const mapleReady = mapleTrunk !== null && mapleCanopy !== null;
    for (const { id, components } of world.query(['Tree', 'TileAnchor', 'TreeViz'])) {
      if (iTrunk >= capacity || iPine >= capacity || iMaple >= capacity) break;
      const anchor = components.TileAnchor;
      const tree = components.Tree;
      const draw = TREE_DRAW.get(tree.kind) ?? FALLBACK_DRAW;
      const g = growthScale(tree.growth);
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      const isPine = tree.kind === 'pine' && pineReady;
      const isMaple = tree.kind === 'maple' && mapleReady;
      if (iShadow < capacity) {
        _position.set(w.x, y + SHADOW_Y_OFFSET, w.z);
        _shadowScale.set(g, 1, g);
        _matrix.compose(_position, _identityQuat, _shadowScale);
        shadowMesh.setMatrixAt(iShadow, _matrix);
        iShadow++;
      }
      _position.set(w.x, y, w.z);
      _trunkScale.set(draw.trunkScale[0] * g, draw.trunkScale[1] * g, draw.trunkScale[2] * g);
      _matrix.compose(_position, _quat, _trunkScale);
      if (isPine && pineTrunk) {
        pineTrunk.setMatrixAt(iPine, _matrix);
        pineTrunk.setColorAt(iPine, draw.trunk);
      } else if (isMaple && mapleTrunk) {
        mapleTrunk.setMatrixAt(iMaple, _matrix);
        mapleTrunk.setColorAt(iMaple, draw.trunk);
      } else {
        trunkMesh.setMatrixAt(iTrunk, _matrix);
        trunkMesh.setColorAt(iTrunk, draw.trunk);
      }
      const canopyY = y + TRUNK_HEIGHT * draw.trunkScale[1] * g;
      _position.set(w.x, canopyY, w.z);
      _canopyScale.set(draw.canopyScale[0] * g, draw.canopyScale[1] * g, draw.canopyScale[2] * g);
      _matrix.compose(_position, _quat, _canopyScale);
      if (isPine && pineCanopy) {
        pineCanopy.setMatrixAt(iPine, _matrix);
        pineCanopy.setColorAt(iPine, draw.canopy);
        pineSlotToEntity[iPine] = id;
        iPine++;
      } else if (isMaple && mapleCanopy) {
        mapleCanopy.setMatrixAt(iMaple, _matrix);
        mapleCanopy.setColorAt(iMaple, draw.canopy);
        mapleSlotToEntity[iMaple] = id;
        iMaple++;
      } else {
        if (draw.canopyShape === 'sphere') {
          canopySphereMesh.setMatrixAt(iSphere, _matrix);
          canopySphereMesh.setColorAt(iSphere, draw.canopy);
          iSphere++;
        } else {
          canopyConeMesh.setMatrixAt(iCone, _matrix);
          canopyConeMesh.setColorAt(iCone, draw.canopy);
          iCone++;
        }
        slotToEntity[iTrunk] = id;
        iTrunk++;
      }
    }
    commitMesh(trunkMesh, iTrunk);
    commitMesh(canopyConeMesh, iCone);
    commitMesh(canopySphereMesh, iSphere);
    commitMesh(shadowMesh, iShadow);
    if (pineTrunk && pineCanopy && iPine > 0) {
      commitMesh(pineTrunk, iPine);
      commitMesh(pineCanopy, iPine);
    }
    if (mapleTrunk && mapleCanopy && iMaple > 0) {
      commitMesh(mapleTrunk, iMaple);
      commitMesh(mapleCanopy, iMaple);
    }
    dirty = false;
  }

  /**
   * Per-frame rebuild of the floating axe marker for every marked tree.
   * Cheap — a handful of marked trees tops.
   *
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
    for (const { components } of world.query(['Tree', 'TileAnchor', 'TreeViz'])) {
      const tree = components.Tree;
      if (tree.markedJobId <= 0) continue;
      if (i >= markerCap) break;
      const anchor = components.TileAnchor;
      const w = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const y = grid.getElevation(anchor.i, anchor.j);
      // Follow the visible top of the tree so saplings don't have a marker
      // floating metres above their tiny canopy.
      const g = growthScale(tree.growth);
      _position.set(w.x, y + MARKER_HOVER_BASE * g + bob, w.z);
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

  /**
   * @param {number} instanceId
   * @param {THREE.InstancedMesh | null} [mesh] which mesh the raycast hit; defaults to trunkMesh
   */
  function entityFromInstanceId(instanceId, mesh) {
    if (mesh && pineTrunkMesh && (mesh === pineTrunkMesh || mesh === pineCanopyMesh)) {
      return pineSlotToEntity[instanceId] ?? null;
    }
    if (mesh && mapleTrunkMesh && (mesh === mapleTrunkMesh || mesh === mapleCanopyMesh)) {
      return mapleSlotToEntity[instanceId] ?? null;
    }
    return slotToEntity[instanceId] ?? null;
  }

  return {
    trunkMesh,
    canopyConeMesh,
    canopySphereMesh,
    get pineTrunkMesh() {
      return pineTrunkMesh;
    },
    get pineCanopyMesh() {
      return pineCanopyMesh;
    },
    get mapleTrunkMesh() {
      return mapleTrunkMesh;
    },
    get mapleCanopyMesh() {
      return mapleCanopyMesh;
    },
    update,
    updateMarkers,
    markDirty,
    entityFromInstanceId,
  };
}
