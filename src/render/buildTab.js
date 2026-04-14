/**
 * Build tab: bottom-left toolbar that replaces the old per-designator
 * keyboard shortcuts (C/B/V/M). One button per designateable kind (chop,
 * stockpile, wall, door). Click toggles the designator on/off; active buttons
 * highlight in the designator's preview color so the UI matches the in-world
 * drag rectangle. Escape still exits whichever mode is active.
 *
 * Button state is re-read every render frame via the designator's public
 * `.active` flag — no plumbing through the designator's onStateChanged, which
 * keeps the tab decoupled from the 4-way mutual-exclusion wiring in main.js.
 *
 * Material ("stuff") picker: wall/door/roof buttons get a right-click popup
 * that lists materials from the stuff registry. Click a material to swap
 * what future placements of this kind will be made of. A swatch strip at the
 * bottom of the button reflects the currently-selected material.
 */

import { STUFF, STUFF_ORDER } from '../world/stuff.js';

/**
 * @typedef {{ active: boolean, activate: () => void, deactivate: () => void }} ToggleableDesignator
 *
 * @typedef {ToggleableDesignator & { currentStuff: string, setStuff: (id: string) => void }} StuffedDesignator
 *
 * @typedef {Object} BuildTabEntry
 * @property {string} id - stable key for cache/highlight ("chop", "wall", …)
 * @property {string} label
 * @property {string} icon - emoji rendered as the button's primary glyph
 * @property {string} hotkeyHint - shown in the tooltip so old muscle-memory still helps
 * @property {string} activeColor - CSS color applied when the designator is active
 * @property {ToggleableDesignator} designator
 * @property {boolean} [stuffed] - if true, right-click opens the material picker and
 *   the button shows a swatch reflecting the designator's currentStuff
 */

/**
 * @typedef {Object} BuildTabOpts
 * @property {ToggleableDesignator} chopDesignator
 * @property {ToggleableDesignator} stockpileDesignator
 * @property {ToggleableDesignator} wallDesignator
 * @property {ToggleableDesignator} doorDesignator
 * @property {ToggleableDesignator} torchDesignator
 * @property {ToggleableDesignator} wallTorchDesignator
 * @property {ToggleableDesignator} roofDesignator
 * @property {ToggleableDesignator} floorDesignator
 * @property {ToggleableDesignator} ignoreRoofDesignator
 * @property {ToggleableDesignator} deconstructDesignator
 * @property {ToggleableDesignator} removeRoofDesignator
 * @property {ToggleableDesignator} removeFloorDesignator
 * @property {ToggleableDesignator} cancelDesignator
 */

/** @param {BuildTabOpts} opts */
export function createBuildTab(opts) {
  /** @type {BuildTabEntry[]} */
  const entries = [
    {
      id: 'chop',
      label: 'Chop',
      icon: '🪓',
      hotkeyHint: 'mark trees for felling',
      activeColor: '#ffae4a',
      designator: opts.chopDesignator,
    },
    {
      id: 'stockpile',
      label: 'Stockpile',
      icon: '📦',
      hotkeyHint: 'designate storage tiles',
      activeColor: '#90d0ff',
      designator: opts.stockpileDesignator,
    },
    {
      id: 'wall',
      label: 'Wall',
      icon: '🧱',
      hotkeyHint: 'build walls (right-click for material)',
      activeColor: '#e9d477',
      designator: opts.wallDesignator,
      stuffed: true,
    },
    {
      id: 'door',
      label: 'Door',
      icon: '🚪',
      hotkeyHint: 'click a tile to place a door (right-click for material)',
      activeColor: '#ffb070',
      designator: opts.doorDesignator,
      stuffed: true,
    },
    {
      id: 'torch',
      label: 'Torch',
      icon: '🔥',
      hotkeyHint: 'click a tile to place a torch',
      activeColor: '#ffb84a',
      designator: opts.torchDesignator,
    },
    {
      id: 'wall-torch',
      label: 'Wall Torch',
      icon: '🕯️',
      hotkeyHint: 'click a tile next to a wall to mount a torch on it',
      activeColor: '#ffd070',
      designator: opts.wallTorchDesignator,
    },
    {
      id: 'roof',
      label: 'Roof',
      icon: '🏠',
      hotkeyHint:
        'drag to designate roofs (free; right-click for material — walls must match to support)',
      activeColor: '#c0a080',
      designator: opts.roofDesignator,
      stuffed: true,
    },
    {
      id: 'floor',
      label: 'Floor',
      icon: '🟫',
      hotkeyHint:
        'drag to designate floors — cows walk at full speed on floors, 85% off them (right-click for material)',
      activeColor: '#bf9a6a',
      designator: opts.floorDesignator,
      stuffed: true,
    },
    {
      id: 'no-roof',
      label: 'No Roof',
      icon: '🚫',
      hotkeyHint: 'drag to mark tiles the auto-roofer should skip',
      activeColor: '#d060ff',
      designator: opts.ignoreRoofDesignator,
    },
    {
      id: 'deconstruct',
      label: 'Demolish',
      icon: '🔨',
      hotkeyHint: 'drag to demolish walls, doors, torches (50% refund)',
      activeColor: '#ff4a4a',
      designator: opts.deconstructDesignator,
    },
    {
      id: 'remove-roof',
      label: 'Un-roof',
      icon: '🏚️',
      hotkeyHint: 'drag to remove roofs only (leaves the walls under them standing)',
      activeColor: '#ff8fd0',
      designator: opts.removeRoofDesignator,
    },
    {
      id: 'remove-floor',
      label: 'Un-floor',
      icon: '🪵',
      hotkeyHint: 'drag to tear up floors only (walls/doors/roofs untouched)',
      activeColor: '#d4a14a',
      designator: opts.removeFloorDesignator,
    },
    {
      id: 'cancel',
      label: 'Cancel',
      icon: '❌',
      hotkeyHint: 'drag to cancel blueprints + pending demolition (refunds delivered resources)',
      activeColor: '#ffe24a',
      designator: opts.cancelDesignator,
    },
  ];

  const root = document.createElement('div');
  root.id = 'build-tab';
  Object.assign(root.style, {
    position: 'fixed',
    bottom: '10px',
    left: '10px',
    display: 'flex',
    gap: '6px',
    padding: '6px',
    background: 'rgba(14, 18, 24, 0.82)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '6px',
    zIndex: '40',
    userSelect: 'none',
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    padding: '0 6px 0 4px',
    color: '#b5c0cc',
    font: "600 11px/1 system-ui, -apple-system, 'Segoe UI', sans-serif",
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    borderRight: '1px solid rgba(255, 255, 255, 0.12)',
  });
  header.textContent = 'Build';
  root.appendChild(header);

  const buttons = entries.map((entry) => {
    const btn = makeButton(entry);
    root.appendChild(btn.el);
    return {
      ...entry,
      ...btn,
      lastActive: /** @type {boolean | null} */ (null),
      lastStuff: /** @type {string | null} */ (null),
    };
  });

  document.body.appendChild(root);

  function update() {
    for (const b of buttons) {
      const active = b.designator.active;
      if (active !== b.lastActive) {
        applyActiveStyle(b.el, active, b.activeColor);
        b.lastActive = active;
      }
      if (b.stuffed && b.swatch) {
        const designator = /** @type {StuffedDesignator} */ (b.designator);
        const stuff = designator.currentStuff;
        if (stuff !== b.lastStuff) {
          applySwatchColor(b.swatch, stuff);
          b.lastStuff = stuff;
        }
      }
    }
  }

  return { update, root };
}

/**
 * @param {BuildTabEntry} entry
 */
function makeButton(entry) {
  const el = document.createElement('button');
  el.type = 'button';
  el.title = `${entry.label} — ${entry.hotkeyHint}`;
  Object.assign(el.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    width: '64px',
    height: '54px',
    padding: '4px',
    background: 'rgba(30, 36, 44, 0.85)',
    color: '#e6e6e6',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: '4px',
    font: "600 10px/1.1 system-ui, -apple-system, 'Segoe UI', sans-serif",
    cursor: 'pointer',
    boxSizing: 'border-box',
    transition: 'border-color 80ms linear, background-color 80ms linear',
  });

  const icon = document.createElement('div');
  icon.textContent = entry.icon;
  Object.assign(icon.style, {
    fontSize: '22px',
    lineHeight: '1',
  });

  const label = document.createElement('div');
  label.textContent = entry.label;

  el.append(icon, label);

  /** @type {HTMLElement | null} */
  let swatch = null;
  if (entry.stuffed) {
    swatch = document.createElement('div');
    Object.assign(swatch.style, {
      width: '26px',
      height: '4px',
      marginTop: '1px',
      borderRadius: '2px',
      background: '#ffffff',
      border: '1px solid rgba(0, 0, 0, 0.35)',
      boxSizing: 'border-box',
    });
    el.appendChild(swatch);
  }

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    // Blur so the <button> doesn't keep focus and swallow subsequent keydowns.
    el.blur();
    if (entry.designator.active) entry.designator.deactivate();
    else entry.designator.activate();
  });
  if (entry.stuffed) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.blur();
      openStuffPicker(el, /** @type {StuffedDesignator} */ (entry.designator));
    });
  }
  // The designators listen on the canvas for mousedown; a button click on
  // body wouldn't hit them anyway, but belt-and-suspenders stop propagation
  // prevents any body-level mousedown listener from reacting.
  el.addEventListener('mousedown', (e) => e.stopPropagation());

  return { el, swatch };
}

/**
 * @param {HTMLElement | null} swatch
 * @param {string} stuffId
 */
function applySwatchColor(swatch, stuffId) {
  if (!swatch) return;
  const def = STUFF[stuffId] ?? STUFF[STUFF_ORDER[0]];
  swatch.style.background = `#${def.wallColor.toString(16).padStart(6, '0')}`;
}

/** @type {HTMLElement | null} */
let openPicker = null;

/**
 * @param {HTMLElement} anchor
 * @param {StuffedDesignator} designator
 */
function openStuffPicker(anchor, designator) {
  closeStuffPicker();
  const menu = document.createElement('div');
  Object.assign(menu.style, {
    position: 'fixed',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '4px',
    background: 'rgba(14, 18, 24, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.22)',
    borderRadius: '4px',
    zIndex: '60',
    font: "600 11px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif",
    color: '#e6e6e6',
    userSelect: 'none',
    minWidth: '120px',
  });
  for (const id of STUFF_ORDER) {
    const def = STUFF[id];
    const item = document.createElement('button');
    item.type = 'button';
    Object.assign(item.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 6px',
      background:
        designator.currentStuff === id ? 'rgba(80, 100, 120, 0.55)' : 'rgba(30, 36, 44, 0.6)',
      color: '#e6e6e6',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '3px',
      font: 'inherit',
      textAlign: 'left',
      cursor: 'pointer',
    });
    const swatch = document.createElement('span');
    Object.assign(swatch.style, {
      display: 'inline-block',
      width: '14px',
      height: '14px',
      borderRadius: '2px',
      background: `#${def.wallColor.toString(16).padStart(6, '0')}`,
      border: '1px solid rgba(0, 0, 0, 0.35)',
    });
    const name = document.createElement('span');
    name.textContent = def.name;
    item.append(swatch, name);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      designator.setStuff(id);
      closeStuffPicker();
    });
    item.addEventListener('mousedown', (e) => e.stopPropagation());
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  // Position above the anchor button (the tab sits at the bottom of the
  // screen, so the menu grows up and to the right).
  const rect = anchor.getBoundingClientRect();
  const menuHeight = menu.getBoundingClientRect().height;
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.top - menuHeight - 4}px`;
  openPicker = menu;
  // Defer the dismiss-on-outside handler so the contextmenu click that
  // opened the menu doesn't immediately close it.
  setTimeout(() => {
    addEventListener('mousedown', dismissOnOutside, true);
    addEventListener('keydown', dismissOnEscape, true);
  }, 0);
}

function closeStuffPicker() {
  if (!openPicker) return;
  openPicker.remove();
  openPicker = null;
  removeEventListener('mousedown', dismissOnOutside, true);
  removeEventListener('keydown', dismissOnEscape, true);
}

/** @param {MouseEvent} e */
function dismissOnOutside(e) {
  if (!openPicker) return;
  if (openPicker.contains(/** @type {Node} */ (e.target))) return;
  closeStuffPicker();
}

/** @param {KeyboardEvent} e */
function dismissOnEscape(e) {
  if (e.code === 'Escape') closeStuffPicker();
}

/**
 * @param {HTMLElement} el
 * @param {boolean} active
 * @param {string} accent
 */
function applyActiveStyle(el, active, accent) {
  if (active) {
    el.style.borderColor = accent;
    el.style.background = 'rgba(52, 48, 24, 0.92)';
    el.style.boxShadow = `0 0 0 1px ${accent} inset, 0 0 8px ${accent}55`;
  } else {
    el.style.borderColor = 'rgba(255, 255, 255, 0.14)';
    el.style.background = 'rgba(30, 36, 44, 0.85)';
    el.style.boxShadow = 'none';
  }
}
