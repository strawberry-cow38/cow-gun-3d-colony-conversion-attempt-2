/**
 * Renders all entities tagged StressViz as instances of a single InstancedMesh.
 * Each render frame, instance matrices are set from `lerp(PrevPosition, Position, alpha)`
 * for visual smoothness independent of the 30Hz sim rate.
 *
 * One mesh, one draw call, thousands of cubes. Good baseline for the Phase 1
 * stress test.
 */

import * as THREE from 'three';

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();

export function createStressInstancer(scene, capacity = 4096) {
  const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const material = new THREE.MeshStandardMaterial({ color: 0xff66aa });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {number} alpha
   */
  function update(world, alpha) {
    let i = 0;
    for (const { components } of world.query(['Position', 'PrevPosition', 'StressViz'])) {
      if (i >= capacity) break;
      const p = components.Position;
      const pp = components.PrevPosition;
      _position.set(
        pp.x + (p.x - pp.x) * alpha,
        pp.y + (p.y - pp.y) * alpha,
        pp.z + (p.z - pp.z) * alpha,
      );
      _matrix.setPosition(_position);
      mesh.setMatrixAt(i, _matrix);
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, update };
}
