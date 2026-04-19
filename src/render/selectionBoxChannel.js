/**
 * Shared translucent ghost-box + wireframe channel used by selection overlays
 * (objects, item stacks). One InstancedMesh renders the translucent fill,
 * a LineSegments streams matching edge vertices so the outline reads even
 * when the fill alpha is low.
 */

import * as THREE from 'three';

/**
 * @typedef {Object} BoxChannel
 * @property {THREE.InstancedMesh} mesh
 * @property {THREE.LineSegments} edges
 * @property {THREE.BufferGeometry} edgeBuffer
 * @property {Float32Array} edgePositions
 * @property {Float32Array} edgeBasePositions
 * @property {number} edgeVertCount
 * @property {number} capacity
 */

/**
 * @param {THREE.Scene} scene
 * @param {number} color
 * @param {number} renderOrder
 * @param {number} capacity
 * @returns {BoxChannel}
 */
export function createBoxChannel(scene, color, renderOrder, capacity) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  scene.add(mesh);

  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.7,
    depthTest: false,
  });
  const edgeBasePositions = /** @type {Float32Array} */ (edgeGeo.getAttribute('position').array);
  const edgeVertCount = edgeBasePositions.length / 3;
  const edgePositions = new Float32Array(capacity * edgeVertCount * 3);
  const edgeBuffer = new THREE.BufferGeometry();
  edgeBuffer.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
  edgeBuffer.setDrawRange(0, 0);
  const edges = new THREE.LineSegments(edgeBuffer, edgeMat);
  edges.frustumCulled = false;
  edges.renderOrder = renderOrder + 1;
  scene.add(edges);

  return {
    mesh,
    edges,
    edgeBuffer,
    edgePositions,
    edgeBasePositions,
    edgeVertCount,
    capacity,
  };
}

/** @param {BoxChannel} ch @param {number} idx @param {THREE.Matrix4} m */
export function writeBoxInstance(ch, idx, m) {
  ch.mesh.setMatrixAt(idx, m);
  const out = ch.edgePositions;
  const base = ch.edgeBasePositions;
  const e = m.elements;
  let p = idx * ch.edgeVertCount * 3;
  for (let i = 0; i < base.length; i += 3) {
    const x = base[i];
    const y = base[i + 1];
    const z = base[i + 2];
    out[p++] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[p++] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[p++] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
}

/** @param {BoxChannel} ch @param {number} count */
export function finalizeBoxChannel(ch, count) {
  ch.mesh.count = count;
  ch.mesh.instanceMatrix.needsUpdate = true;
  ch.mesh.visible = count > 0;
  ch.edgeBuffer.setDrawRange(0, count * ch.edgeVertCount);
  ch.edgeBuffer.attributes.position.needsUpdate = true;
  ch.edges.visible = count > 0;
}
