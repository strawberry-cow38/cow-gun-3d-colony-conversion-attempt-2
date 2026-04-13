/**
 * Portrait strip along the top-right of the screen.
 *
 * One card per live cow: a colored disc with two-letter initials, the cow's
 * name, and the current activity text (same phrasing as the floating thought
 * bubbles so the two match). Click a card to select that cow in the world
 * (respects Shift for additive selection); double-click to snap the camera
 * onto them and engage follow mode. Cards get visual state for `selected`,
 * `primary` (the active cow in a multi-select), and `focused` (the cow the
 * camera is currently tracking — either via follow or first-person).
 *
 * The cow list is queried every render frame; DOM is only rebuilt when the
 * set of living cows actually changes (spawn/despawn). Text + highlight
 * classes are updated per-card with change-detection so we don't touch the
 * DOM unless something moved.
 */

import { thoughtFor } from './cowThoughtText.js';

/**
 * @typedef {Object} PortraitBarOpts
 * @property {import('../ecs/world.js').World} world
 * @property {import('../boot/input.js').BootState} state
 * @property {{ active: boolean, cowId: number | null }} fpCamera
 * @property {(id: number, additive: boolean) => void} onSelect
 * @property {(id: number) => void} onFocus
 */

/** @param {PortraitBarOpts} opts */
export function createCowPortraitBar(opts) {
  const { world, state, fpCamera, onSelect, onFocus } = opts;

  const root = document.createElement('div');
  root.id = 'cow-portraits';
  Object.assign(root.style, {
    position: 'fixed',
    top: '8px',
    right: '8px',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: '6px',
    padding: '0',
    margin: '0',
    maxWidth: 'min(640px, calc(100vw - 420px))',
    zIndex: '40',
    pointerEvents: 'none',
  });
  document.body.appendChild(root);

  /**
   * @typedef {Object} Card
   * @property {HTMLDivElement} el
   * @property {HTMLDivElement} avatar
   * @property {HTMLDivElement} nameEl
   * @property {HTMLDivElement} activityEl
   * @property {string} name
   * @property {string} activity
   * @property {string} styleKey
   */
  /** @type {Map<number, Card>} */
  const cards = new Map();

  function focusedCowId() {
    if (fpCamera.active && fpCamera.cowId !== null) return fpCamera.cowId;
    if (state.followEnabled && state.primaryCow !== null) return state.primaryCow;
    return null;
  }

  function update() {
    const focusedId = focusedCowId();
    const alive = new Set();
    for (const { id, components } of world.query(['Cow', 'Brain', 'Job'])) {
      alive.add(id);
      let card = cards.get(id);
      if (!card) {
        card = makeCard(id, components.Brain.name, onSelect, onFocus);
        root.appendChild(card.el);
        cards.set(id, card);
      }

      const name = components.Brain.name;
      if (name !== card.name) {
        card.nameEl.textContent = name;
        card.avatar.textContent = initialsOf(name);
        card.avatar.style.background = hueForName(name);
        card.name = name;
      }
      const activity = thoughtFor(components.Job);
      if (activity !== card.activity) {
        card.activityEl.textContent = activity;
        card.activity = activity;
      }

      const isSelected = state.selectedCows.has(id);
      const isPrimary = state.primaryCow === id;
      const isFocused = focusedId === id;
      const isDrafted = components.Cow.drafted === true;
      const styleKey = `${isSelected ? 's' : ''}${isPrimary ? 'p' : ''}${isFocused ? 'f' : ''}${isDrafted ? 'd' : ''}`;
      if (styleKey !== card.styleKey) {
        applyHighlight(card.el, { isSelected, isPrimary, isFocused, isDrafted });
        card.styleKey = styleKey;
      }
    }

    for (const [id, card] of cards) {
      if (!alive.has(id)) {
        card.el.remove();
        cards.delete(id);
      }
    }
  }

  return { update, root };
}

/**
 * @param {number} id
 * @param {string} initialName
 * @param {(id: number, additive: boolean) => void} onSelect
 * @param {(id: number) => void} onFocus
 * @returns {{ el: HTMLDivElement, avatar: HTMLDivElement, nameEl: HTMLDivElement, activityEl: HTMLDivElement, name: string, activity: string, styleKey: string }}
 */
function makeCard(id, initialName, onSelect, onFocus) {
  const el = document.createElement('div');
  Object.assign(el.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: '132px',
    maxWidth: '132px',
    padding: '4px 6px',
    background: 'rgba(14, 18, 24, 0.82)',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    borderRadius: '4px',
    color: '#e6e6e6',
    font: "11px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif",
    cursor: 'pointer',
    pointerEvents: 'auto',
    userSelect: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 80ms linear, background-color 80ms linear',
  });
  el.title = 'Click to select · Double-click to focus camera';

  const avatar = document.createElement('div');
  Object.assign(avatar.style, {
    width: '28px',
    height: '28px',
    flex: '0 0 28px',
    borderRadius: '50%',
    background: hueForName(initialName),
    color: '#111',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '700',
    fontSize: '11px',
    letterSpacing: '0.5px',
    textShadow: '0 1px 0 rgba(255, 255, 255, 0.35)',
  });
  avatar.textContent = initialsOf(initialName);

  const text = document.createElement('div');
  Object.assign(text.style, {
    display: 'flex',
    flexDirection: 'column',
    minWidth: '0',
    flex: '1 1 auto',
  });

  const nameEl = document.createElement('div');
  Object.assign(nameEl.style, {
    fontWeight: '600',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  nameEl.textContent = initialName;

  const activityEl = document.createElement('div');
  Object.assign(activityEl.style, {
    color: '#b5c0cc',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  text.append(nameEl, activityEl);
  el.append(avatar, text);

  // dblclick fires after click in the standard DOM sequence, so the single-
  // click always runs first (selection) and the double-click layers focus on
  // top. That matches how Rimworld's colonist bar behaves.
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onSelect(id, e.shiftKey);
  });
  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onFocus(id);
  });

  return { el, avatar, nameEl, activityEl, name: initialName, activity: '', styleKey: '' };
}

/**
 * @param {HTMLElement} el
 * @param {{ isSelected: boolean, isPrimary: boolean, isFocused: boolean, isDrafted: boolean }} s
 */
function applyHighlight(el, s) {
  // Layered: focused (brightest) > primary > selected > drafted-tint > default.
  if (s.isFocused) {
    el.style.borderColor = '#7cffb0';
    el.style.background = 'rgba(28, 58, 40, 0.9)';
    el.style.boxShadow = '0 0 0 1px #7cffb0 inset, 0 0 8px rgba(124, 255, 176, 0.35)';
  } else if (s.isPrimary) {
    el.style.borderColor = '#e9d477';
    el.style.background = 'rgba(40, 38, 22, 0.88)';
    el.style.boxShadow = '0 0 0 1px #e9d477 inset';
  } else if (s.isSelected) {
    el.style.borderColor = '#f4c860';
    el.style.background = 'rgba(28, 26, 18, 0.86)';
    el.style.boxShadow = 'none';
  } else {
    el.style.borderColor = s.isDrafted ? 'rgba(255, 120, 120, 0.55)' : 'rgba(255, 255, 255, 0.18)';
    el.style.background = 'rgba(14, 18, 24, 0.82)';
    el.style.boxShadow = 'none';
  }
}

/** @param {string} name */
function initialsOf(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * Deterministic pastel color from a name string — cheap hash → HSL. Gives
 * each cow a recognizable avatar tint without needing per-cow art.
 *
 * @param {string} name
 */
function hueForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 72%)`;
}
