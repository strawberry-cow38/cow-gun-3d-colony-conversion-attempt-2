import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { FACING_OFFSETS, FACING_YAWS } from '../world/facing.js';

export const FURNACE_FOOTPRINT = TILE_SIZE * 0.86;
export const FURNACE_HEIGHT = 1.4 * UNITS_PER_METER;
const CHIMNEY_WIDTH = TILE_SIZE * 0.28;
const CHIMNEY_HEIGHT = 0.7 * UNITS_PER_METER;
const GLOW_WIDTH = TILE_SIZE * 0.42;
const GLOW_HEIGHT = 0.35 * UNITS_PER_METER;
const GLOW_DEPTH = 0.05 * UNITS_PER_METER;
const GLOW_Y = 0.45 * UNITS_PER_METER;
const GLOW_FRONT_OFFSET = FURNACE_FOOTPRINT * 0.5 + GLOW_DEPTH * 0.4;

const BODY_COLOR = 0x5a5048;
const CHIMNEY_COLOR = 0x3a3430;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createFurnaceInstancer(scene, capacity = 64) {
  const bodyGeo = new THREE.BoxGeometry(FURNACE_FOOTPRINT, FURNACE_HEIGHT, FURNACE_FOOTPRINT);
  bodyGeo.translate(0, FURNACE_HEIGHT * 0.5, 0);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    roughness: 0.88,
    metalness: 0.05,
  });
  const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, capacity);
  bodyMesh.count = 0;
  bodyMesh.frustumCulled = false;
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  scene.add(bodyMesh);

  const chimneyGeo = new THREE.BoxGeometry(CHIMNEY_WIDTH, CHIMNEY_HEIGHT, CHIMNEY_WIDTH);
  chimneyGeo.translate(0, FURNACE_HEIGHT + CHIMNEY_HEIGHT * 0.5, 0);
  const chimneyMat = new THREE.MeshStandardMaterial({
    color: CHIMNEY_COLOR,
    roughness: 0.95,
  });
  const chimneyMesh = new THREE.InstancedMesh(chimneyGeo, chimneyMat, capacity);
  chimneyMesh.count = 0;
  chimneyMesh.frustumCulled = false;
  chimneyMesh.castShadow = true;
  scene.add(chimneyMesh);

  const glowGeo = new THREE.BoxGeometry(GLOW_WIDTH, GLOW_HEIGHT, GLOW_DEPTH);
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xff7a28,
    emissive: 0xff5a12,
    emissiveIntensity: 0.6,
    roughness: 0.4,
  });
  const glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, capacity);
  glowMesh.count = 0;
  glowMesh.frustumCulled = false;
  scene.add(glowMesh);

  /** @type {{ entityId: number, active: boolean }[]} */
  const slots = [];
  let dirty = true;
  const IDLE_INTENSITY = 0.35;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    _scale.set(1, 1, 1);
    slots.length = 0;
    let i = 0;
    for (const { id, components } of world.query(['Furnace', 'TileAnchor', 'FurnaceViz'])) {
      if (i >= capacity) break;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);
      const facing = components.Furnace.facing | 0;
      const yaw = FACING_YAWS[facing] ?? 0;
      _quat.setFromAxisAngle(_yAxis, yaw);

      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      bodyMesh.setMatrixAt(i, _matrix);
      chimneyMesh.setMatrixAt(i, _matrix);

      // Glow sits on the "front" face — offset rotated by the same yaw so it
      // tracks the furnace's actual facing direction.
      const off = FACING_OFFSETS[facing] ?? FACING_OFFSETS[0];
      _position.set(w.x + off.di * GLOW_FRONT_OFFSET, y + GLOW_Y, w.z + off.dj * GLOW_FRONT_OFFSET);
      _matrix.compose(_position, _quat, _scale);
      glowMesh.setMatrixAt(i, _matrix);

      slots.push({ entityId: id, active: components.Furnace.activeBillId > 0 });
      i++;
    }
    bodyMesh.count = i;
    chimneyMesh.count = i;
    glowMesh.count = i;
    bodyMesh.instanceMatrix.needsUpdate = true;
    chimneyMesh.instanceMatrix.needsUpdate = true;
    glowMesh.instanceMatrix.needsUpdate = true;
    dirty = false;
  }

  /**
   * Per-frame glow pulse. Reads the cached `slot.active` populated by update();
   * callers that start/stop a bill must markDirty to flip the visual.
   *
   * @param {number} timeSec
   */
  function updateGlow(timeSec) {
    if (slots.length === 0) return;
    let anyActive = false;
    for (const slot of slots) {
      if (slot.active) {
        anyActive = true;
        break;
      }
    }
    const next = anyActive ? 0.75 + 0.25 * Math.sin(timeSec * Math.PI * 1.8) : IDLE_INTENSITY;
    if (glowMat.emissiveIntensity !== next) glowMat.emissiveIntensity = next;
  }

  function markDirty() {
    dirty = true;
  }

  /** @param {number} instanceId */
  function entityFromInstanceId(instanceId) {
    return slots[instanceId]?.entityId ?? null;
  }

  return {
    bodyMesh,
    chimneyMesh,
    glowMesh,
    update,
    updateGlow,
    markDirty,
    entityFromInstanceId,
  };
}

/**
 * Translucent furnace silhouette + chimney for the placement preview. Single
 * mesh group, follow-the-cursor positioning. The interaction-spot marker is a
 * separate object since it lives one tile away from the body.
 *
 * @param {THREE.Scene} scene
 */
export function createFurnaceGhost(scene) {
  const group = new THREE.Group();
  group.visible = false;
  group.frustumCulled = false;

  const ghostMat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    roughness: 0.9,
  });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(FURNACE_FOOTPRINT, FURNACE_HEIGHT, FURNACE_FOOTPRINT),
    ghostMat,
  );
  body.position.y = FURNACE_HEIGHT * 0.5;
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(CHIMNEY_WIDTH, CHIMNEY_HEIGHT, CHIMNEY_WIDTH),
    ghostMat,
  );
  chimney.position.y = FURNACE_HEIGHT + CHIMNEY_HEIGHT * 0.5;
  group.add(body, chimney);
  scene.add(group);

  return { group, ghostMat };
}
