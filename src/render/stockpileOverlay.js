/**
 * Stockpile overlay. One InstancedMesh of flat quads, one instance per
 * stockpile tile, floated just above the ground so players can see which
 * tiles belong to a stockpile even when the tile is empty. A second brighter
 * quad layer highlights every tile of the currently-selected zone so the
 * player can see the zone extent at a glance.
 *
 * Uses a dirty flag flipped by the designator on any stockpile change, plus
 * a per-selection signature for the highlight pass.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';

const TILE_GROUND_CLEARANCE = 0.04 * UNITS_PER_METER;
const TILE_PAD = 0.04 * TILE_SIZE;
const HILITE_LIFT = 0.02 * UNITS_PER_METER;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ');
const _scale = new THREE.Vector3(TILE_SIZE - TILE_PAD * 2, TILE_SIZE - TILE_PAD * 2, 1);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createStockpileOverlay(scene, capacity = 4096) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x4ac0ff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const hiliteMat = new THREE.MeshBasicMaterial({
    color: 0xffe14a,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const hilite = new THREE.InstancedMesh(geo, hiliteMat, capacity);
  hilite.count = 0;
  hilite.frustumCulled = false;
  hilite.renderOrder = 1;
  scene.add(hilite);

  _quat.setFromEuler(_euler);
  let dirty = true;
  let lastSelectionKey = '';

  /**
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {import('../systems/stockpileZones.js').StockpileZones} [zones]
   * @param {number | null} [selectedZoneId]
   */
  function update(grid, zones, selectedZoneId) {
    if (dirty) {
      let k = 0;
      for (let j = 0; j < grid.H; j++) {
        for (let i = 0; i < grid.W; i++) {
          if (!grid.isStockpile(i, j)) continue;
          if (k >= capacity) break;
          const w = tileToWorld(i, j, grid.W, grid.H);
          const y = grid.getElevation(i, j) + TILE_GROUND_CLEARANCE;
          _position.set(w.x, y, w.z);
          _matrix.compose(_position, _quat, _scale);
          mesh.setMatrixAt(k, _matrix);
          k++;
        }
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      dirty = false;
      lastSelectionKey = '';
    }

    const selZone = zones && selectedZoneId != null ? zones.zoneById(selectedZoneId) : null;
    const selKey = selZone ? `${selectedZoneId}:${selZone.tiles.size}` : '';
    if (selKey === lastSelectionKey) return;
    lastSelectionKey = selKey;

    if (!selZone) {
      hilite.count = 0;
      hilite.visible = false;
      return;
    }
    let k = 0;
    for (const idx of selZone.tiles) {
      if (k >= capacity) break;
      const i = idx % grid.W;
      const j = (idx - i) / grid.W;
      const w = tileToWorld(i, j, grid.W, grid.H);
      const y = grid.getElevation(i, j) + TILE_GROUND_CLEARANCE + HILITE_LIFT;
      _position.set(w.x, y, w.z);
      _matrix.compose(_position, _quat, _scale);
      hilite.setMatrixAt(k, _matrix);
      k++;
    }
    hilite.count = k;
    hilite.instanceMatrix.needsUpdate = true;
    hilite.visible = k > 0;
  }

  function markDirty() {
    dirty = true;
  }

  /** @param {boolean} v */
  function setVisible(v) {
    mesh.visible = v;
    if (!v) hilite.visible = false;
  }

  return { mesh, update, markDirty, setVisible };
}
