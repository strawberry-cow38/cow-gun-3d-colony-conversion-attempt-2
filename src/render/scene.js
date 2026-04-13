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
  scene.background = new THREE.Color(0x8fb8e8);

  // Far plane sized for a 200×200 grid at 1.5m tiles (~8570u across).
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    50000,
  );
  camera.position.set(15, 18, 22);
  camera.lookAt(0, 0, 0);

  scene.add(buildSky());

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x4a4230, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1d0, 0.9);
  sun.position.set(3000, 5000, 2000);
  scene.add(sun);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  return { renderer, scene, camera };
}

function buildSky() {
  const geo = new THREE.SphereGeometry(40000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x2c5a9e) },
      horizonColor: { value: new THREE.Color(0xd9b88a) },
      bottomColor: { value: new THREE.Color(0x1a1f2a) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h >= 0.0
          ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.55))
          : mix(horizonColor, bottomColor, pow(clamp(-h, 0.0, 1.0), 0.6));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}
