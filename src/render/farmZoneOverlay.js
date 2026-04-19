/**
 * Farm-zone overlay. InstancedMesh of flat green quads sitting just above
 * ground so zoned tiles stay visible even when empty. Dirty-flagged by the
 * designator on any farmZone change. A second hilite layer brightens every
 * tile of the currently-selected zone so the player can see zone extent at
 * a glance.
 *
 * Separate from the tilled overlay so un-zoning a planted tile still shows
 * soil rows underneath until a cow re-tills or the player tills manually.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { CROP_VISUALS, KIND_FOR_CROP_ID } from '../world/crops.js';

const TILE_GROUND_CLEARANCE = 0.04 * UNITS_PER_METER;
const TILE_PAD = 0.04 * TILE_SIZE;
const HILITE_LIFT = 0.02 * UNITS_PER_METER;

// Pre-bake zoneId → ripe color so the W×H sweep skips the kind-lookup +
// setHex per tile. Only the zoneIds with a registered crop kind land here;
// unknown ids get the fallback.
const ZONE_COLORS = new Map();
for (const idKey of Object.keys(KIND_FOR_CROP_ID)) {
  const kind = KIND_FOR_CROP_ID[Number(idKey)];
  const v = CROP_VISUALS[kind];
  if (!v) continue;
  ZONE_COLORS.set(Number(idKey), new THREE.Color(v.ripeColor));
}
const FALLBACK_COLOR = new THREE.Color(0x44dd88);

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ');
const _scale = new THREE.Vector3(TILE_SIZE - TILE_PAD * 2, TILE_SIZE - TILE_PAD * 2, 1);

/**
 * @param {THREE.Scene} scene
 * @param {number} capacity
 */
export function createFarmZoneOverlay(scene, capacity = 4096) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x44dd88,
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
   * @param {import('../systems/farmZones.js').FarmZones} [zones]
   * @param {number | null} [selectedZoneId]
   */
  function update(grid, zones, selectedZoneId) {
    if (dirty) {
      let k = 0;
      for (let j = 0; j < grid.H; j++) {
        for (let i = 0; i < grid.W; i++) {
          const zoneId = grid.getFarmZone(i, j);
          if (zoneId === 0) continue;
          if (k >= capacity) break;
          const w = tileToWorld(i, j, grid.W, grid.H);
          const y = grid.getElevation(i, j) + TILE_GROUND_CLEARANCE;
          _position.set(w.x, y, w.z);
          _matrix.compose(_position, _quat, _scale);
          mesh.setMatrixAt(k, _matrix);
          mesh.setColorAt(k, ZONE_COLORS.get(zoneId) ?? FALLBACK_COLOR);
          k++;
        }
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      dirty = false;
      // Sentinel — '' is also the no-selection key, so a dirty rebuild that
      // coincides with the selected zone being deleted would otherwise leave
      // the hilite stuck on forever.
      lastSelectionKey = '\0';
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
