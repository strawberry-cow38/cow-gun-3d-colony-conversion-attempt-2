/**
 * Thin wrapper around the vendored three-wboit WboitPass.
 *
 * Replaces the plain `renderer.render(scene, camera)` call with a weighted-blended
 * order-independent transparency pipeline:
 *   1. opaque pass → canvas
 *   2. sorted-transparent pass → canvas (for materials that set `transparent:true`
 *      but NOT `wboitEnabled`)
 *   3. WBOIT accumulation + revealage + composite → canvas
 *
 * Any material that opts into order-independent blending should set
 * `material.wboitEnabled = true` (or use MeshWboitMaterial / WboitUtils.patch).
 */

import { WboitPass } from './wboit/WboitPass.js';

/**
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 */
export function createWboitRenderer(renderer, scene, camera) {
  const pass = new WboitPass(renderer, scene, camera);

  const onResize = () => {
    const pr = renderer.getPixelRatio();
    pass.setSize(Math.floor(window.innerWidth * pr), Math.floor(window.innerHeight * pr));
  };
  window.addEventListener('resize', onResize);

  return {
    /** Render the current scene with OIT. Targets the canvas. */
    render() {
      pass.render(renderer, null);
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      pass.dispose();
    },
  };
}
