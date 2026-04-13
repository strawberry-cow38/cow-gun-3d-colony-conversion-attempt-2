/**
 * Door render: two InstancedMeshes — the wooden slab (hinged on one edge so
 * it can swing) and a short top frame filling the gap up to wall height. The
 * top frame uses the wall material color so doors slot visually into a wall
 * run.
 *
 * Per-door animation state (openAmount 0..1) lives in a Map keyed by entity
 * id. Each render frame we check which cows are close to which doors (small
 * N×M scan — door and cow counts stay low) and ease openAmount toward 0 or
 * 1. A rising-edge trigger (was-closed → now-opening) plays a spatial creak
 * sfx so the sound only fires once per swing, not every frame.
 *
 * Matrices are rebuilt every frame because the slab is animated. The top
 * frame is static but gets rebuilt in the same pass (cheap, avoids a second
 * dirty-flag path).
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const WALL_HEIGHT = 3 * UNITS_PER_METER;
const DOOR_HEIGHT = 2.4 * UNITS_PER_METER;
const DOOR_THICKNESS = TILE_SIZE * 0.2;
const TOP_FRAME_HEIGHT = WALL_HEIGHT - DOOR_HEIGHT;
const OPEN_RADIUS = TILE_SIZE * 1.1;
const SWING_MAX = Math.PI * 0.5;
// Time constants for the open/close tween (seconds). Opening is a touch
// faster so doors feel responsive when a cow walks up; closing eases out so
// it doesn't slam.
const OPEN_TAU = 0.12;
const CLOSE_TAU = 0.35;
const OPEN_SFX_THRESHOLD = 0.05;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 * @param {{ playAt: (kind: string, pos: { x: number, y: number, z: number }) => void } | null} audio
 */
export function createDoorInstancer(scene, capacity, audio) {
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xb87333, flatShading: true });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, flatShading: true });

  // Slab geometry: hinge at +X edge at origin, bottom at y=0. Default axis
  // runs along -X (door spans from hinge at x=0 to x=-TILE_SIZE).
  const slabGeo = new THREE.BoxGeometry(TILE_SIZE, DOOR_HEIGHT, DOOR_THICKNESS);
  slabGeo.translate(-TILE_SIZE * 0.5, DOOR_HEIGHT * 0.5, 0);
  const slab = new THREE.InstancedMesh(slabGeo, slabMat, capacity);
  slab.count = 0;
  slab.frustumCulled = false;
  scene.add(slab);

  const frameGeo = new THREE.BoxGeometry(TILE_SIZE, TOP_FRAME_HEIGHT, TILE_SIZE);
  frameGeo.translate(0, DOOR_HEIGHT + TOP_FRAME_HEIGHT * 0.5, 0);
  const frame = new THREE.InstancedMesh(frameGeo, frameMat, capacity);
  frame.count = 0;
  frame.frustumCulled = false;
  scene.add(frame);

  /** @type {Map<number, { open: number, emittedSfx: boolean }>} */
  const state = new Map();
  let lastNow = performance.now();

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;

    // Snapshot cow world positions once — each door runs its own proximity
    // check against this small array rather than re-querying per door.
    /** @type {{ x: number, z: number }[]} */
    const cowPositions = [];
    for (const { components } of world.query(['Cow', 'Position'])) {
      cowPositions.push({ x: components.Position.x, z: components.Position.z });
    }

    const kOpen = 1 - Math.exp(-dt / OPEN_TAU);
    const kClose = 1 - Math.exp(-dt / CLOSE_TAU);
    const openRadiusSq = OPEN_RADIUS * OPEN_RADIUS;
    /** @type {Set<number>} */
    const seen = new Set();

    let n = 0;
    let nFrame = 0;
    for (const { id, components } of world.query(['Door', 'TileAnchor', 'DoorViz'])) {
      if (n >= capacity) break;
      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j);

      // Axis selection: if adjacent walls sit east/west, run the slab along
      // X (baseAngle=0). If they sit north/south, run it along Z (baseAngle=
      // π/2). Pure cardinal test — mixed runs default to EW.
      const wallsEW = grid.isWall(a.i - 1, a.j) || grid.isWall(a.i + 1, a.j);
      const wallsNS = grid.isWall(a.i, a.j - 1) || grid.isWall(a.i, a.j + 1);
      const rotateNS = wallsNS && !wallsEW;
      const baseAngle = rotateNS ? Math.PI / 2 : 0;
      const hasAdjacentWalls = wallsEW || wallsNS;

      // Proximity check: open if any cow is within OPEN_RADIUS of tile center.
      let shouldOpen = false;
      for (const p of cowPositions) {
        const dx = p.x - w.x;
        const dz = p.z - w.z;
        if (dx * dx + dz * dz <= openRadiusSq) {
          shouldOpen = true;
          break;
        }
      }

      // Ease openness toward the target. Separate time constants for opening
      // vs closing (see constants above).
      let st = state.get(id);
      if (!st) {
        st = { open: 0, emittedSfx: false };
        state.set(id, st);
      }
      seen.add(id);
      const target = shouldOpen ? 1 : 0;
      const k = target > st.open ? kOpen : kClose;
      st.open += (target - st.open) * k;
      if (st.open < 1e-3) st.open = 0;

      // Rising-edge sfx: fire creak once when the swing kicks off, not every
      // frame while open. Reset the latch when the door returns to closed so
      // the next approach triggers it again.
      if (target === 1 && !st.emittedSfx && st.open >= OPEN_SFX_THRESHOLD) {
        audio?.playAt('door', { x: w.x, y: y + DOOR_HEIGHT * 0.5, z: w.z });
        st.emittedSfx = true;
      } else if (target === 0 && st.open < OPEN_SFX_THRESHOLD) {
        st.emittedSfx = false;
      }

      // Compose slab matrix. Hinge point sits on the tile edge determined by
      // baseAngle; the slab swings by SWING_MAX * openAmount around Y.
      const swingAngle = st.open * SWING_MAX;
      const totalAngle = baseAngle + swingAngle;
      _quat.setFromAxisAngle(Y_AXIS, totalAngle);
      // Hinge offset in world: rotate (TILE_SIZE/2, 0, 0) by baseAngle around
      // Y. For baseAngle=0 → (+TILE/2, 0, 0); for baseAngle=π/2 → (0, 0,
      // -TILE/2) per three.js right-handed Y-rotation convention.
      const cb = Math.cos(baseAngle);
      const sb = Math.sin(baseAngle);
      const hingeX = cb * (TILE_SIZE * 0.5);
      const hingeZ = -sb * (TILE_SIZE * 0.5);
      _position.set(w.x + hingeX, y, w.z + hingeZ);
      _matrix.compose(_position, _quat, _scale);
      slab.setMatrixAt(n++, _matrix);

      // Top frame: only emit when the door actually slots into a wall run —
      // a lonely door wouldn't have a wall above it in the first place.
      if (hasAdjacentWalls && nFrame < capacity) {
        _quat.setFromAxisAngle(Y_AXIS, 0);
        _position.set(w.x, y, w.z);
        _matrix.compose(_position, _quat, _scale);
        frame.setMatrixAt(nFrame++, _matrix);
      }
    }

    // Garbage-collect state for doors that no longer exist (save-load, cancel
    // via future teardown UI, etc.). Size stays bounded by the current door
    // entity count.
    if (state.size > seen.size) {
      for (const key of state.keys()) if (!seen.has(key)) state.delete(key);
    }

    slab.count = n;
    frame.count = nFrame;
    slab.instanceMatrix.needsUpdate = true;
    frame.instanceMatrix.needsUpdate = true;
  }

  return { update };
}
