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
 */

/**
 * @typedef {{ active: boolean, activate: () => void, deactivate: () => void }} ToggleableDesignator
 *
 * @typedef {Object} BuildTabEntry
 * @property {string} id - stable key for cache/highlight ("chop", "wall", …)
 * @property {string} label
 * @property {string} icon - emoji rendered as the button's primary glyph
 * @property {string} hotkeyHint - shown in the tooltip so old muscle-memory still helps
 * @property {string} activeColor - CSS color applied when the designator is active
 * @property {ToggleableDesignator} designator
 */

/**
 * @typedef {Object} BuildTabOpts
 * @property {ToggleableDesignator} chopDesignator
 * @property {ToggleableDesignator} stockpileDesignator
 * @property {ToggleableDesignator} wallDesignator
 * @property {ToggleableDesignator} doorDesignator
 * @property {ToggleableDesignator} torchDesignator
 * @property {ToggleableDesignator} roofDesignator
 * @property {ToggleableDesignator} ignoreRoofDesignator
 * @property {ToggleableDesignator} deconstructDesignator
 * @property {ToggleableDesignator} removeRoofDesignator
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
      hotkeyHint: 'build wooden walls',
      activeColor: '#e9d477',
      designator: opts.wallDesignator,
    },
    {
      id: 'door',
      label: 'Door',
      icon: '🚪',
      hotkeyHint: 'click a tile to place a door',
      activeColor: '#ffb070',
      designator: opts.doorDesignator,
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
      id: 'roof',
      label: 'Roof',
      icon: '🏠',
      hotkeyHint: 'drag to designate roofs (free, fast, auto-built in rooms)',
      activeColor: '#c0a080',
      designator: opts.roofDesignator,
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
    return { ...entry, ...btn, lastActive: /** @type {boolean | null} */ (null) };
  });

  document.body.appendChild(root);

  function update() {
    for (const b of buttons) {
      const active = b.designator.active;
      if (active !== b.lastActive) {
        applyActiveStyle(b.el, active, b.activeColor);
        b.lastActive = active;
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

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    // Blur so the <button> doesn't keep focus and swallow subsequent keydowns.
    el.blur();
    if (entry.designator.active) entry.designator.deactivate();
    else entry.designator.activate();
  });
  // The designators listen on the canvas for mousedown; a button click on
  // body wouldn't hit them anyway, but belt-and-suspenders stop propagation
  // prevents any body-level mousedown listener from reacting.
  el.addEventListener('mousedown', (e) => e.stopPropagation());

  return { el };
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
