/**
 * Three.js scene + camera + lighting setup.
 *
 * Stays dumb: just creates the scene graph + a perspective camera + ambient/sun
 * lights + ground. Returns handles. Wiring to the sim happens in main.js.
 */

import * as THREE from 'three';

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161c);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(15, 18, 22);
  camera.lookAt(0, 0, 0);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x222632 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(10, 20, 10);
  scene.add(sun);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  return { renderer, scene, camera };
}
