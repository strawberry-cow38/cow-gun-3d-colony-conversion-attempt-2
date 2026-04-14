/**
 * Demolition-queue overlay. One InstancedMesh of red-tinted quads floated just
 * above the ground on every tile whose Wall/Door/Torch/Roof currently carries
 * a pending deconstructJobId. Gives the player a visible "pending demolition"
 * indicator that mirrors how ignoreRoofOverlay shows ignore-roof tiles.
 *
 * Dirty is tripped by the deconstruct + cancel designators, and by
 * onWorldBuildComplete (which fires on deconstruct finish, so the overlay
 * releases the tile once the job's done).
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const TILE_GROUND_CLEARANCE = 0.05 * UNITS_PER_METER;
const TILE_PAD = 0.04 * TILE_SIZE;

const DECON_COMPS = /** @type {const} */ (['Wall', 'Door', 'Torch', 'Roof']);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ');
const _scale = new THREE.Vector3(TILE_SIZE - TILE_PAD * 2, TILE_SIZE - TILE_PAD * 2, 1);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createDeconstructOverlay(scene, capacity = 4096) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff4a4a,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  _quat.setFromEuler(_euler);
  let dirty = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, grid) {
    if (!dirty) return;
    let k = 0;
    const seen = new Set();
    for (const comp of DECON_COMPS) {
      for (const { components } of world.query([comp, 'TileAnchor'])) {
        if (components[comp].deconstructJobId === 0) continue;
        const a = components.TileAnchor;
        // A tile can host a wall+roof (or door+roof) simultaneously; dedupe so
        // we don't z-fight two identical quads at the same spot.
        const idx = a.j * grid.W + a.i;
        if (seen.has(idx)) continue;
        seen.add(idx);
        if (k >= capacity) break;
        const w = tileToWorld(a.i, a.j, grid.W, grid.H);
        const y = grid.getElevation(a.i, a.j) + TILE_GROUND_CLEARANCE;
        _position.set(w.x, y, w.z);
        _matrix.compose(_position, _quat, _scale);
        mesh.setMatrixAt(k, _matrix);
        k++;
      }
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    dirty = false;
  }

  function markDirty() {
    dirty = true;
  }

  return { mesh, update, markDirty };
}
