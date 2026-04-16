/**
 * Floating HTML overlay showing the current drag rectangle's size (N × M
 * tiles, metres, total area). Every drag-based designator shares this — the
 * label sits just off the cursor and mirrors the preview line's accent color
 * so a glance tells the player which mode is staging the rect.
 */

import { TILE_SIZE, UNITS_PER_METER } from '../world/coords.js';

const METERS_PER_TILE = TILE_SIZE / UNITS_PER_METER;

/** @param {number} hex */
export function colorToCss(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * @typedef {Object} DragSizeLabelConfig
 * @property {string} addVerb - label prefix when placing (e.g. "chop", "build")
 * @property {string} [cancelVerb] - label prefix when shift-drag cancels; falls
 *   back to `addVerb` for designators that only add (cancel, ignoreRoof-clear)
 * @property {number} addHex - border color while adding
 * @property {number} [removeHex] - border color while removing; defaults to `addHex`
 */

/** @param {DragSizeLabelConfig} config */
export function createDragSizeLabel(config) {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    display: 'none',
    padding: '8px 14px',
    background: 'rgba(14, 18, 24, 0.9)',
    color: '#ffffff',
    font: '700 22px/1.1 system-ui, -apple-system, Segoe UI, sans-serif',
    border: '2px solid #ffffff',
    borderRadius: '4px',
    pointerEvents: 'none',
    zIndex: '50',
    whiteSpace: 'nowrap',
    textAlign: 'center',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.7)',
  });
  const size = document.createElement('div');
  const sub = document.createElement('div');
  Object.assign(sub.style, {
    marginTop: '3px',
    font: '500 11px/1.2 system-ui, -apple-system, Segoe UI, sans-serif',
    opacity: '0.75',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  });
  el.appendChild(size);
  el.appendChild(sub);
  document.body.appendChild(el);

  const addCss = colorToCss(config.addHex);
  const removeCss = colorToCss(config.removeHex ?? config.addHex);
  const cancelVerb = config.cancelVerb ?? config.addVerb;
  let lastSize = '';
  let lastSub = '';
  let lastBorder = '';
  let visible = false;

  /**
   * @param {MouseEvent} e
   * @param {{ i: number, j: number } | null} startTile
   * @param {{ i: number, j: number } | null} curTile
   * @param {boolean} [removing]
   */
  function render(e, startTile, curTile, removing) {
    if (!startTile || !curTile) {
      hide();
      return;
    }
    const w = Math.abs(curTile.i - startTile.i) + 1;
    const h = Math.abs(curTile.j - startTile.j) + 1;
    const wm = (w * METERS_PER_TILE).toFixed(1);
    const hm = (h * METERS_PER_TILE).toFixed(1);
    const verb = removing ? cancelVerb : config.addVerb;
    const sizeText = `${w} × ${h}`;
    const subText = `${verb} · ${wm}m × ${hm}m · ${w * h} tiles`;
    if (sizeText !== lastSize) {
      size.textContent = sizeText;
      lastSize = sizeText;
    }
    if (subText !== lastSub) {
      sub.textContent = subText;
      lastSub = subText;
    }
    const border = removing ? removeCss : addCss;
    if (border !== lastBorder) {
      el.style.borderColor = border;
      lastBorder = border;
    }
    el.style.left = `${e.clientX + 20}px`;
    el.style.top = `${e.clientY + 20}px`;
    if (!visible) {
      el.style.display = 'block';
      visible = true;
    }
  }

  function hide() {
    if (!visible) return;
    el.style.display = 'none';
    visible = false;
  }

  return { render, hide };
}
