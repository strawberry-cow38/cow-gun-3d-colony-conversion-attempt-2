/**
 * Shared helpers for the tile-based selectors (ItemSelector, ObjectSelector,
 * ...). Two operations repeat verbatim: raycasting a click against the tile
 * mesh to get (i, j), and collecting entity ids that fall inside the current
 * camera frustum.
 */

import * as THREE from 'three';
import { worldToTile } from '../world/coords.js';

const _ndc = new THREE.Vector2();
const _frustum = new THREE.Frustum();
const _projView = new THREE.Matrix4();
const _point = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();

/**
 * Raycast a click against the tile mesh, returning the hit (i, j) or null
 * when the click misses the ground or lands outside bounds.
 *
 * @param {MouseEvent} e
 * @param {HTMLElement} dom
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Mesh} tileMesh
 * @param {{ W: number, H: number }} grid
 */
export function pickTileFromEvent(e, dom, camera, tileMesh, grid) {
  const rect = dom.getBoundingClientRect();
  _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_ndc, camera);
  const hits = _raycaster.intersectObject(tileMesh, false);
  if (hits.length === 0) return null;
  const p = hits[0].point;
  const t = worldToTile(p.x, p.z, grid.W, grid.H);
  if (t.i < 0) return null;
  return t;
}

/**
 * Iterate a world query and collect ids whose Position is inside the camera
 * frustum. `predicate` can filter further (e.g. "only items of kind X").
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {import('../ecs/world.js').World} world
 * @param {string[]} components  must include 'Position' for the frustum test
 * @param {(components: Record<string, any>) => boolean} [predicate]
 */
export function frustumVisibleIds(camera, world, components, predicate) {
  camera.updateMatrixWorld();
  _projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projView);
  const out = [];
  for (const { id, components: c } of world.query(components)) {
    if (predicate && !predicate(c)) continue;
    const pos = c.Position;
    _point.set(pos.x, pos.y, pos.z);
    if (_frustum.containsPoint(_point)) out.push(id);
  }
  return out;
}
