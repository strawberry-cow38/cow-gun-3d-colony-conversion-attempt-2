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
  scene.background = new THREE.Color(0x3a2350);

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

  // Sunset palette: warm peach from the sun direction, cool purple fill.
  scene.add(new THREE.HemisphereLight(0xffb27a, 0x2a1a3a, 0.65));
  const sun = new THREE.DirectionalLight(0xffb46b, 1.0);
  sun.position.set(4000, 1600, -2500);
  scene.add(sun);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  });

  return { renderer, scene, camera };
}

function buildSky() {
  const geo = new THREE.SphereGeometry(40000, 64, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      zenithColor: { value: new THREE.Color(0x2a1838) },
      upperSkyColor: { value: new THREE.Color(0x4d2a58) },
      horizonGlow: { value: new THREE.Color(0xffa267) },
      horizonLow: { value: new THREE.Color(0xff7a3a) },
      groundColor: { value: new THREE.Color(0x1a0e26) },
      cloudWarm: { value: new THREE.Color(0xffd0a0) },
      cloudCool: { value: new THREE.Color(0x6a3a78) },
      cloudDark: { value: new THREE.Color(0x2c1840) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 zenithColor;
      uniform vec3 upperSkyColor;
      uniform vec3 horizonGlow;
      uniform vec3 horizonLow;
      uniform vec3 groundColor;
      uniform vec3 cloudWarm;
      uniform vec3 cloudCool;
      uniform vec3 cloudDark;
      varying vec3 vDir;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 5; i++) {
          s += a * vnoise(p);
          p *= 2.02;
          a *= 0.5;
        }
        return s;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;

        // Base sky gradient. Below horizon stays dusky purple; above horizon
        // runs a hot band of sunset glow that fades up into deep purple.
        vec3 col;
        if (h >= 0.0) {
          float band = smoothstep(0.0, 0.18, h);
          col = mix(horizonLow, horizonGlow, smoothstep(0.0, 0.08, h));
          col = mix(col, upperSkyColor, band);
          col = mix(col, zenithColor, smoothstep(0.25, 0.95, h));
        } else {
          col = mix(horizonLow, groundColor, pow(clamp(-h, 0.0, 1.0), 0.45));
        }

        // Clouds: stretched streaks biased toward the sunset band. Azimuth in
        // X, elevation in Y — scaled asymmetrically so they look horizontal.
        if (h > -0.02 && h < 0.9) {
          float az = atan(d.x, d.z);
          vec2 cp = vec2(az * 2.2, h * 5.5);
          float n = fbm(cp);
          float bandMask = smoothstep(1.0, 0.1, h) * smoothstep(-0.02, 0.05, h);
          float cloudAmt = smoothstep(0.42, 0.72, n) * bandMask;

          // Sunset-lit clouds glow warm near the horizon, cool + dark up top.
          vec3 cloudCol = mix(cloudCool, cloudWarm, smoothstep(0.0, 0.22, h));
          cloudCol = mix(cloudDark, cloudCol, smoothstep(0.3, 0.7, n));

          col = mix(col, cloudCol, cloudAmt * 0.88);
        }

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
