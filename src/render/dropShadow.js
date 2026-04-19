/**
 * Flat circular drop-shadow decal. InstancedMesh of a ground-aligned disc
 * rendered in straight black with low opacity — PS2-era fake shadow under
 * trees, boulders, bushes so they read as sitting on the ground even when
 * the sun's real shadow map misses them (alpha-cutout billboards can't cast
 * a convincing shadow, and short objects fall outside the shadow frustum's
 * slope bias).
 *
 * `renderOrder = -1` + `depthWrite = false` so the disc blends under every
 * other transparent decor without stealing the depth buffer.
 */

import * as THREE from 'three';

/**
 * @param {import('three').Scene} scene
 * @param {number} capacity
 * @param {number} radius world-units
 * @param {number} [opacity]
 */
export function createDropShadowInstancedMesh(scene, capacity, radius, opacity = 0.35) {
  const geo = new THREE.CircleGeometry(radius, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
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
