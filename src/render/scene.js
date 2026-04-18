/**
 * Three.js scene + camera + lighting setup.
 *
 * Stays dumb: just creates the scene graph + a perspective camera + ambient/sun
 * lights + ground. Returns handles. Wiring to the sim happens in main.js.
 */

import * as THREE from 'three';
import { TILE_SIZE } from '../world/coords.js';
import { createComposer } from './postprocessing.js';

// Sun-shadow footprint. Orthographic half-extent around the light's target —
// renderFrame pins the target to the RTS focus point, so this is effectively
// "how many tiles around the camera get real sun shadows". 40 tiles ≈ a
// comfortable RTS viewport with slack for pans before the next shadow refresh.
const SUN_SHADOW_HALF = 40 * TILE_SIZE;
// Sun sits `SUN_DISTANCE` units from its target in timeOfDay's unit vector *
// 4000 path. Keep near/far bracketing that range.
const SUN_DISTANCE = 4000;

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // Single directional-sun shadow map covers the scene. PCF (not Soft) because
  // at RTS distance on a 2048 map the soft-filter penumbra is invisible and
  // we'd rather spend the samples elsewhere.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // ACES + linear → sRGB gives the postprocessing stack proper headroom for
  // bloom and the curve-based grader. Exposure tuned slightly hot so the
  // dreamcore highlight tint has something to bite into.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a2350);
  // Linear fog tinted by timeOfDay each frame. Range tuned for ~30 tiles
  // start, ~80 tiles end at 43u/tile — soft horizon haze, not a wall.
  scene.fog = new THREE.Fog(0x6a3aa0, 30 * TILE_SIZE, 80 * TILE_SIZE);

  // Far plane sized for a 200×200 grid at 1.5m tiles (~8570u across).
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    50000,
  );
  camera.position.set(15, 18, 22);
  camera.lookAt(0, 0, 0);

  const sky = buildSky();
  scene.add(sky);

  // Sunset palette at construction — time-of-day system retints every frame.
  const hemi = new THREE.HemisphereLight(0xffb27a, 0x2a1a3a, 0.65);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb46b, 1.0);
  sun.position.set(4000, 1600, -2500);
  // Directional shadow: one ortho camera covers ~40 tiles around sun.target.
  // renderFrame moves the target to rts.focus and flips needsUpdate only when
  // focus / sun direction has shifted enough that the cached shadow would
  // misalign — otherwise the map is reused frame-to-frame for free.
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -SUN_SHADOW_HALF;
  sun.shadow.camera.right = SUN_SHADOW_HALF;
  sun.shadow.camera.top = SUN_SHADOW_HALF;
  sun.shadow.camera.bottom = -SUN_SHADOW_HALF;
  sun.shadow.camera.near = 0.25 * SUN_DISTANCE;
  sun.shadow.camera.far = 2 * SUN_DISTANCE;
  sun.shadow.bias = -0.0005;
  sun.shadow.autoUpdate = false;
  scene.add(sun);
  // Explicit target so renderFrame can reposition the shadow frustum around
  // the camera focus; must be in the scene graph for matrixWorld to update.
  scene.add(sun.target);

  // Visible celestial body in the sky. Lives just inside the sky sphere
  // so it always renders behind in-world geometry but in front of the
  // skybox. timeOfDay positions sunDisc/moonDisc each frame so they match
  // the directional light's angle (sunDisc) and its astronomical opposite
  // (moonDisc). Lit purely by emissive — they're light sources, not lit
  // surfaces.
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(4500, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
  );
  sunDisc.frustumCulled = false;
  sunDisc.renderOrder = -0.5;
  scene.add(sunDisc);
  const moonDisc = new THREE.Mesh(
    new THREE.SphereGeometry(3500, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0xe6e6f0 }),
  );
  moonDisc.frustumCulled = false;
  moonDisc.renderOrder = -0.5;
  scene.add(moonDisc);

  const post = createComposer(renderer, scene, camera);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    post.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, sun, hemi, sky, sunDisc, moonDisc, post };
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

      // Cellular star field: hash a coarse cell, only emit a star above a
      // sparse threshold, attenuate by distance to a per-cell jittered point.
      float starfield(vec3 d, float density, float bigness) {
        // Project direction onto a "sky uv" — concentric latitude bands kept
        // round by dividing azimuth by altitude factor so cells don't pinch
        // toward the zenith.
        float az = atan(d.x, d.z);
        vec2 uv = vec2(az * 30.0, d.y * 60.0);
        vec2 i = floor(uv);
        vec2 f = fract(uv);
        float seed = hash(i);
        if (seed < 1.0 - density) return 0.0;
        vec2 starCenter = vec2(hash(i + 13.0), hash(i + 41.0));
        float dist = length(f - starCenter);
        float intensity = hash(i + 71.0);
        return smoothstep(bigness, 0.0, dist) * (0.4 + intensity * 0.6);
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

        // Stars: visible only when zenith is dark (night). Mask by zenith
        // luminance so they fade in/out with sunrise/sunset automatically.
        if (h > 0.05) {
          float zenithLuma = dot(zenithColor, vec3(0.299, 0.587, 0.114));
          float nightMask = 1.0 - smoothstep(0.04, 0.18, zenithLuma);
          if (nightMask > 0.001) {
            float horizonRise = smoothstep(0.05, 0.35, h);
            float s = starfield(d, 0.012, 0.18) * horizonRise;
            float bigStars = starfield(d, 0.0025, 0.34) * horizonRise;
            col += vec3(0.85, 0.9, 1.0) * s * nightMask * 1.4;
            col += vec3(1.0, 0.95, 0.85) * bigStars * nightMask * 2.0;
          }
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
