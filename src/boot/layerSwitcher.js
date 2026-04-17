/**
 * Active-Z layer switcher for the RTS camera.
 *
 * Binds the on-screen up/down buttons (touch-friendly) and exposes a
 * `setActiveZ` / `bump` surface the keyboard hotkey table routes Q/E
 * through. Lifts the camera focus by `LAYER_HEIGHT` per step so the orbit
 * center tracks the currently-viewed floor rather than staying glued to
 * the ground plane.
 */

import { LAYER_HEIGHT } from '../world/tileGrid.js';

/**
 * @typedef {object} LayerSwitcherDeps
 * @property {import('../world/tileWorld.js').TileWorld} tileWorld
 * @property {{ focus: { y: number } }} rts
 * @property {() => void} [onChange]
 */

/**
 * @typedef {object} LayerSwitcherApi
 * @property {(z: number) => void} setActiveZ
 * @property {(delta: number) => void} bump
 */

/**
 * @param {LayerSwitcherDeps} deps
 * @returns {LayerSwitcherApi}
 */
export function createLayerSwitcher({ tileWorld, rts, onChange }) {
  const labelEl = document.getElementById('layer-label');
  const upEl = document.getElementById('layer-up');
  const downEl = document.getElementById('layer-down');

  const refreshLabel = () => {
    if (labelEl) labelEl.textContent = `Z${tileWorld.activeZ}`;
  };

  /** @param {number} z */
  const setActiveZ = (z) => {
    const maxZ = Math.max(0, tileWorld.depth - 1);
    const clamped = Math.max(0, Math.min(maxZ, z));
    if (clamped === tileWorld.activeZ) return;
    tileWorld.activeZ = clamped;
    rts.focus.y = clamped * LAYER_HEIGHT;
    refreshLabel();
    if (onChange) onChange();
  };

  /** @param {number} delta */
  const bump = (delta) => setActiveZ(tileWorld.activeZ + delta);

  if (upEl) upEl.addEventListener('click', () => bump(1));
  if (downEl) downEl.addEventListener('click', () => bump(-1));

  refreshLabel();

  return { setActiveZ, bump };
}
