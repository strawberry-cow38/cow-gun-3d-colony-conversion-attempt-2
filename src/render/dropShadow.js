/**
 * Flat blob drop-shadow decal. InstancedMesh of a ground-aligned quad
 * textured with a radial falloff — the same soft blob used under cows and
 * item stacks (see dropShadows.js), so decor (trees, boulders, bushes) reads
 * with matching shadow language.
 *
 * `renderOrder = -1` + `depthWrite = false` so the disc blends under every
 * other transparent decor without stealing the depth buffer.
 */

import * as THREE from 'three';

/** @type {THREE.CanvasTexture | null} */
let _sharedShadowTex = null;

export function makeShadowTexture() {
  if (_sharedShadowTex) return _sharedShadowTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _sharedShadowTex = new THREE.CanvasTexture(c);
  _sharedShadowTex.minFilter = THREE.LinearFilter;
  _sharedShadowTex.magFilter = THREE.LinearFilter;
  return _sharedShadowTex;
}

/**
 * @param {import('three').Scene} scene
 * @param {number} capacity
 * @param {number} radius world-units
 * @param {number} [opacity]
 */
export function createDropShadowInstancedMesh(scene, capacity, radius, opacity = 0.55) {
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: makeShadowTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.renderOrder = -1;
  scene.add(mesh);
  return mesh;
}
