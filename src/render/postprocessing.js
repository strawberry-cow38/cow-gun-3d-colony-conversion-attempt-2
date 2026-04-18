/**
 * PS2-dreamcore postprocessing stack: bloom + curve-based color grading LUT.
 *
 * Built on EffectComposer. Order: scene → bloom → grade → screen.
 *
 * The "LUT" here is a curve-based color grader (no texture asset) — gives us
 * runtime-tunable saturation/lift/gamma/tint controls keyed off time-of-day.
 * Swap to a real LUT3D later if we want a hand-authored palette.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const dreamcoreGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.25 },
    uContrast: { value: 1.08 },
    uLiftRgb: { value: new THREE.Color(0.02, 0.0, 0.04) },
    uGammaRgb: { value: new THREE.Color(1.0, 1.0, 1.0) },
    uGainRgb: { value: new THREE.Color(1.04, 1.0, 1.06) },
    uShadowTint: { value: new THREE.Color(0x3a2055) },
    uHighlightTint: { value: new THREE.Color(0xffd0a8) },
    uShadowTintAmount: { value: 0.18 },
    uHighlightTintAmount: { value: 0.08 },
    uVignetteAmount: { value: 0.22 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uLiftRgb;
    uniform vec3 uGammaRgb;
    uniform vec3 uGainRgb;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uShadowTintAmount;
    uniform float uHighlightTintAmount;
    uniform float uVignetteAmount;
    varying vec2 vUv;

    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;

      // Lift / gamma / gain (ASC-CDL style). Lift adds to shadows, gain
      // multiplies highlights, gamma reshapes midtones.
      c = c * uGainRgb + uLiftRgb;
      c = pow(max(c, vec3(0.0)), vec3(1.0) / max(uGammaRgb, vec3(0.0001)));

      // Luma-based shadow/highlight tint — push shadows cool/violet, highlights warm.
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      float shadowMask = smoothstep(0.5, 0.0, luma);
      float highlightMask = smoothstep(0.55, 1.0, luma);
      c = mix(c, c * uShadowTint * 2.0, shadowMask * uShadowTintAmount);
      c = mix(c, c * uHighlightTint * 1.4, highlightMask * uHighlightTintAmount);

      // Saturation around per-pixel luma.
      float lumaPost = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(lumaPost), c, uSaturation);

      // Contrast around 0.5 mid-grey.
      c = (c - 0.5) * uContrast + 0.5;

      // Soft vignette — radial darken from screen center.
      vec2 vignUv = vUv - 0.5;
      float vign = smoothstep(0.85, 0.25, length(vignUv));
      c *= mix(1.0, vign, uVignetteAmount);

      gl_FragColor = vec4(max(c, vec3(0.0)), src.a);
    }
  `,
};

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 */
export function createComposer(renderer, scene, camera) {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const pixelRatio = renderer.getPixelRatio();

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Bloom: low threshold so saturated-but-not-blown lights still bleed; moderate
  // strength so neon signage / sun disc glow without nuking detail.
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 0.78);
  composer.addPass(bloomPass);

  const gradePass = new ShaderPass(dreamcoreGradeShader);
  composer.addPass(gradePass);

  function setSize(w, h) {
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
  }

  return { composer, bloomPass, gradePass, setSize };
}
