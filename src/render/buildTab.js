/**
 * Build palette: RimWorld-style nested picker anchored at bottom-left.
 *
 *   [Build]  →  clicking opens a column of Categories above the button.
 *   Clicking a category opens a second column (to the right of the category
 *   column) with the designator buttons for that category. Clicking a
 *   designator activates it. Escape closes the whole palette.
 *
 * Button state is re-read every render frame via the designator's public
 * `.active` flag — no plumbing through onStateChanged, which keeps the tab
 * decoupled from the mutual-exclusion wiring in main.js.
 *
 * Material ("stuff") / crop picker: wall/door/roof/floor/farm buttons get a
 * right-click popup. The swatch strip on the button reflects the current
 * stuff/crop.
 */

import { CROP_KINDS, CROP_VISUALS } from '../world/crops.js';
import { STUFF, STUFF_ORDER } from '../world/stuff.js';
import { colorToCss } from './dragSizeLabel.js';

/**
 * @typedef {{ active: boolean, activate: () => void, deactivate: () => void }} ToggleableDesignator
 *
 * @typedef {ToggleableDesignator & { currentStuff: string, setStuff: (id: string) => void }} StuffedDesignator
 *
 * @typedef {ToggleableDesignator & { currentCrop: string, setCrop: (kind: string) => void }} CroppableDesignator
 *
 * @typedef {Object} BuildTabEntry
 * @property {string} id - stable key for cache/highlight ("chop", "wall", …)
 * @property {string} label
 * @property {string} icon - emoji rendered as the button's primary glyph
 * @property {string} hotkeyHint - shown in the tooltip so old muscle-memory still helps
 * @property {string} activeColor - CSS color applied when the designator is active
 * @property {string} categoryId - which category column this entry lives under
 * @property {ToggleableDesignator} designator
 * @property {string} [hotkey] - KeyboardEvent.code that activates this entry while
 *   its owning category is open (e.g. "KeyT"). Same letter may repeat across
 *   categories; scope keeps them from colliding.
 * @property {boolean} [stuffed] - if true, right-click opens the material picker and
 *   the button shows a swatch reflecting the designator's currentStuff
 * @property {boolean} [croppable] - if true, right-click opens the crop-kind picker
 *   and the button shows a swatch reflecting the designator's currentCrop
 */

/**
 * @typedef {Object} BuildCategory
 * @property {string} id
 * @property {string} label
 * @property {string} icon
 * @property {string} [hotkey] - KeyboardEvent.code that opens this category when
 *   the build palette is open (e.g. "KeyO" for Orders).
 */

/**
 * Categories are declarative: add a row here to get a new tab. An entry lands
 * in a tab by matching on `categoryId`. Empty categories render as a greyed-
 * out tab so the palette can advertise upcoming buckets before their contents
 * exist (e.g. furniture sits here while beds/chairs/tables are still TBD).
 *
 * @type {BuildCategory[]}
 */
const CATEGORIES = [
  { id: 'orders', label: 'Orders', icon: '📋', hotkey: 'KeyO' },
  { id: 'zones', label: 'Zones', icon: '📐', hotkey: 'KeyZ' },
  { id: 'structure', label: 'Structure', icon: '🏗️', hotkey: 'KeyU' },
  { id: 'furniture', label: 'Furniture', icon: '🪑', hotkey: 'KeyI' },
  { id: 'production', label: 'Production', icon: '⚙️', hotkey: 'KeyM' },
  { id: 'lighting', label: 'Lighting', icon: '💡', hotkey: 'KeyG' },
];

// Cancel + Demolish are injected into every category that doesn't already
// host them (Orders does). Keeps C / X available as the last row of every
// palette tab — matching RimWorld muscle memory.
const SHARED_ORDER_ENTRIES = /** @type {const} */ ([
  {
    baseId: 'cancel',
    label: 'Cancel',
    icon: '❌',
    hotkey: 'KeyC',
    activeColor: '#ffe24a',
    hotkeyHint: 'drag to cancel blueprints + pending demolition (refunds delivered resources)',
    designatorKey: 'cancelDesignator',
  },
  {
    baseId: 'deconstruct',
    label: 'Demolish',
    icon: '🔨',
    hotkey: 'KeyX',
    activeColor: '#ff4a4a',
    hotkeyHint: 'drag to demolish walls, doors, torches (50% refund)',
    designatorKey: 'deconstructDesignator',
  },
]);

/**
 * @typedef {Object} BuildTabApi
 * @property {() => void} update
 * @property {HTMLElement} root
 * @property {{ open: boolean, openCategoryId: string | null }} state
 * @property {() => void} toggleOpen
 * @property {(id: string) => void} openCategory
 * @property {(id: string) => boolean} activateEntry
 * @property {(code: string) => BuildTabEntry | null} findEntryByHotkey
 * @property {(code: string) => BuildCategory | null} findCategoryByHotkey
 *
 * @typedef {Object} BuildTabOpts
 * @property {ToggleableDesignator} chopDesignator
 * @property {ToggleableDesignator} cutDesignator
 * @property {ToggleableDesignator} mineDesignator
 * @property {ToggleableDesignator} stockpileDesignator
 * @property {ToggleableDesignator} farmZoneDesignator
 * @property {ToggleableDesignator} wallDesignator
 * @property {ToggleableDesignator} doorDesignator
 * @property {ToggleableDesignator} torchDesignator
 * @property {ToggleableDesignator} wallTorchDesignator
 * @property {ToggleableDesignator} roofDesignator
 * @property {ToggleableDesignator} floorDesignator
 * @property {ToggleableDesignator} furnaceDesignator
 * @property {ToggleableDesignator} easelDesignator
 * @property {ToggleableDesignator} stoveDesignator
 * @property {ToggleableDesignator} ignoreRoofDesignator
 * @property {ToggleableDesignator} deconstructDesignator
 * @property {ToggleableDesignator} removeRoofDesignator
 * @property {ToggleableDesignator} removeFloorDesignator
 * @property {ToggleableDesignator} uninstallDesignator
 * @property {ToggleableDesignator} cancelDesignator
 */

/** @param {BuildTabOpts} opts */
export function createBuildTab(opts) {
  /** @type {BuildTabEntry[]} */
  const entries = [
    // Orders — mark/unmark actions on existing world tiles/objects.
    {
      id: 'chop',
      label: 'Chop',
      icon: '🪓',
      hotkeyHint: 'mark mature trees for felling (≥50% grown)',
      activeColor: '#ffae4a',
      categoryId: 'orders',
      hotkey: 'KeyT',
      designator: opts.chopDesignator,
    },
    {
      id: 'cut',
      label: 'Cut',
      icon: '✂️',
      hotkeyHint:
        'snip saplings, unripe crops, brush — yields whatever they\u2019re currently worth',
      activeColor: '#9fdc5a',
      categoryId: 'orders',
      hotkey: 'KeyK',
      designator: opts.cutDesignator,
    },
    {
      id: 'mine',
      label: 'Mine',
      icon: '⛏️',
      hotkeyHint: 'mark boulders for mining',
      activeColor: '#bad9ff',
      categoryId: 'orders',
      hotkey: 'KeyN',
      designator: opts.mineDesignator,
    },
    {
      id: 'deconstruct',
      label: 'Demolish',
      icon: '🔨',
      hotkeyHint: 'drag to demolish walls, doors, torches (50% refund)',
      activeColor: '#ff4a4a',
      categoryId: 'orders',
      hotkey: 'KeyX',
      designator: opts.deconstructDesignator,
    },
    {
      id: 'remove-roof',
      label: 'Un-roof',
      icon: '🏚️',
      hotkeyHint: 'drag to remove roofs only (leaves the walls under them standing)',
      activeColor: '#ff8fd0',
      categoryId: 'orders',
      hotkey: 'KeyY',
      designator: opts.removeRoofDesignator,
    },
    {
      id: 'remove-floor',
      label: 'Un-floor',
      icon: '🪵',
      hotkeyHint: 'drag to tear up floors only (walls/doors/roofs untouched)',
      activeColor: '#d4a14a',
      categoryId: 'orders',
      hotkey: 'KeyL',
      designator: opts.removeFloorDesignator,
    },
    {
      id: 'uninstall',
      label: 'Uninstall Art',
      icon: '🖼️',
      hotkeyHint: 'click a painting on a wall to pry it off and return it to storage',
      activeColor: '#ff8fd0',
      categoryId: 'orders',
      hotkey: 'KeyJ',
      designator: opts.uninstallDesignator,
    },
    {
      id: 'cancel',
      label: 'Cancel',
      icon: '❌',
      hotkeyHint: 'drag to cancel blueprints + pending demolition (refunds delivered resources)',
      activeColor: '#ffe24a',
      categoryId: 'orders',
      hotkey: 'KeyC',
      designator: opts.cancelDesignator,
    },

    // Zones — area designations.
    {
      id: 'stockpile',
      label: 'Stockpile',
      icon: '📦',
      hotkeyHint: 'designate storage tiles',
      activeColor: '#90d0ff',
      categoryId: 'zones',
      hotkey: 'KeyT',
      designator: opts.stockpileDesignator,
    },
    {
      id: 'farm',
      label: 'Farm',
      icon: '🌾',
      hotkeyHint: 'designate growing zones (right-click for crop kind)',
      activeColor: '#6fe2a0',
      categoryId: 'zones',
      hotkey: 'KeyK',
      designator: opts.farmZoneDesignator,
      croppable: true,
    },
    {
      id: 'no-roof',
      label: 'No Roof',
      icon: '🚫',
      hotkeyHint: 'drag to mark tiles the auto-roofer should skip',
      activeColor: '#d060ff',
      categoryId: 'zones',
      hotkey: 'KeyN',
      designator: opts.ignoreRoofDesignator,
    },

    // Structure — permanent building pieces.
    {
      id: 'wall',
      label: 'Wall',
      icon: '🧱',
      hotkeyHint: 'build walls (right-click for material)',
      activeColor: '#e9d477',
      categoryId: 'structure',
      hotkey: 'KeyL',
      designator: opts.wallDesignator,
      stuffed: true,
    },
    {
      id: 'door',
      label: 'Door',
      icon: '🚪',
      hotkeyHint: 'click a tile to place a door (right-click for material)',
      activeColor: '#ffb070',
      categoryId: 'structure',
      hotkey: 'KeyK',
      designator: opts.doorDesignator,
      stuffed: true,
    },
    {
      id: 'roof',
      label: 'Roof',
      icon: '🏠',
      hotkeyHint:
        'drag to designate roofs (free; right-click for material — walls must match to support)',
      activeColor: '#c0a080',
      categoryId: 'structure',
      hotkey: 'KeyT',
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
      categoryId: 'structure',
      hotkey: 'KeyJ',
      designator: opts.floorDesignator,
      stuffed: true,
    },

    // Production — crafting / creation stations.
    {
      id: 'furnace',
      label: 'Furnace',
      icon: '🏭',
      hotkeyHint: 'click a tile to place a furnace (15 stone)',
      activeColor: '#d2785a',
      categoryId: 'production',
      hotkey: 'KeyT',
      designator: opts.furnaceDesignator,
    },
    {
      id: 'easel',
      label: 'Easel',
      icon: '🎨',
      hotkeyHint: 'click a tile to place an easel (8 wood) — R rotates facing',
      activeColor: '#d8b26a',
      categoryId: 'production',
      hotkey: 'KeyJ',
      designator: opts.easelDesignator,
    },
    {
      id: 'stove',
      label: 'Stove',
      icon: '🥄',
      hotkeyHint: 'click to place a 3x1 stove (25 stone) — R rotates facing',
      activeColor: '#d2b98a',
      categoryId: 'production',
      hotkey: 'KeyK',
      designator: opts.stoveDesignator,
    },

    // Lighting.
    {
      id: 'torch',
      label: 'Torch',
      icon: '🔥',
      hotkeyHint: 'click a tile to place a torch',
      activeColor: '#ffb84a',
      categoryId: 'lighting',
      hotkey: 'KeyT',
      designator: opts.torchDesignator,
    },
    {
      id: 'wall-torch',
      label: 'Wall Torch',
      icon: '🕯️',
      hotkeyHint: 'click a tile next to a wall to mount a torch on it',
      activeColor: '#ffd070',
      categoryId: 'lighting',
      hotkey: 'KeyK',
      designator: opts.wallTorchDesignator,
    },
  ];

  // Cancel + Demolish appear in every non-orders tab too — same designator
  // reference, suffixed id to keep each button uniquely addressable.
  for (const cat of CATEGORIES) {
    if (cat.id === 'orders') continue;
    for (const shared of SHARED_ORDER_ENTRIES) {
      entries.push({
        id: `${shared.baseId}-${cat.id}`,
        label: shared.label,
        icon: shared.icon,
        hotkeyHint: shared.hotkeyHint,
        activeColor: shared.activeColor,
        categoryId: cat.id,
        hotkey: shared.hotkey,
        designator: /** @type {ToggleableDesignator} */ (
          /** @type {Record<string, ToggleableDesignator>} */ (opts)[shared.designatorKey]
        ),
      });
    }
  }

  const root = document.createElement('div');
  root.id = 'build-tab';
  Object.assign(root.style, {
    position: 'fixed',
    bottom: '10px',
    left: '10px',
    display: 'flex',
    alignItems: 'flex-end',
    gap: '6px',
    zIndex: '40',
    userSelect: 'none',
  });

  // Root "Build" button — always visible, toggles the category column.
  const buildButton = document.createElement('button');
  buildButton.type = 'button';
  buildButton.title = 'Build — open construction palette';
  Object.assign(buildButton.style, {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    width: '68px',
    height: '54px',
    padding: '4px',
    background: 'rgba(14, 18, 24, 0.92)',
    color: '#e6e6e6',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '6px',
    font: "600 11px/1.1 system-ui, -apple-system, 'Segoe UI', sans-serif",
    cursor: 'pointer',
    boxSizing: 'border-box',
    transition: 'border-color 80ms linear, background-color 80ms linear',
  });
  const buildIcon = document.createElement('div');
  buildIcon.textContent = '🔨';
  Object.assign(buildIcon.style, { fontSize: '22px', lineHeight: '1' });
  const buildLabel = document.createElement('div');
  buildLabel.textContent = 'Build';
  buildButton.append(buildIcon, buildLabel);
  root.appendChild(buildButton);

  // Category column — sits to the right of the Build button, grows upward.
  const categoryColumn = makeColumn('Build');
  categoryColumn.style.display = 'none';
  root.appendChild(categoryColumn);

  // Designator column — sits to the right of the category column.
  const designatorColumn = makeColumn('');
  designatorColumn.style.display = 'none';
  root.appendChild(designatorColumn);

  // Placeholder shown in the designator column when the active category has
  // no entries yet (e.g. Furniture while beds/chairs/tables are TBD). Sits
  // alongside the real designator buttons and is shown/hidden by syncPanels.
  const emptyPlaceholder = document.createElement('div');
  Object.assign(emptyPlaceholder.style, {
    padding: '10px 8px',
    color: '#8a95a3',
    font: "italic 500 11px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif",
    textAlign: 'center',
    minWidth: '172px',
    display: 'none',
  });
  emptyPlaceholder.textContent = 'Nothing here yet';
  designatorColumn.body.appendChild(emptyPlaceholder);

  // Count how many entries live under each category so the category tab can
  // render greyed-out when empty and the designator column can fall back to
  // the "nothing here yet" placeholder.
  const entryCounts = /** @type {Record<string, number>} */ ({});
  for (const cat of CATEGORIES) entryCounts[cat.id] = 0;
  for (const e of entries) {
    if (e.categoryId in entryCounts) entryCounts[e.categoryId]++;
  }

  /** @type {{ id: string, el: HTMLButtonElement, empty: boolean }[]} */
  const categoryButtons = [];
  for (const cat of CATEGORIES) {
    const empty = entryCounts[cat.id] === 0;
    const btn = makeCategoryButton(cat, empty);
    categoryColumn.body.appendChild(btn);
    categoryButtons.push({ id: cat.id, el: btn, empty });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.blur();
      // Changing or collapsing the open category drops any armed tool —
      // the user has indicated they're no longer acting on that palette.
      deactivateActive();
      if (state.openCategoryId === cat.id) {
        state.openCategoryId = null;
      } else {
        state.openCategoryId = cat.id;
      }
      syncPanels();
    });
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // One designator button per entry; placed in the designator column body,
  // but only shown when its category is the active one.
  const buttons = entries.map((entry) => {
    const btn = makeButton(entry);
    designatorColumn.body.appendChild(btn.el);
    btn.el.style.display = 'none';
    return {
      ...entry,
      ...btn,
      lastActive: /** @type {boolean | null} */ (null),
      lastStuff: /** @type {string | null} */ (null),
      lastCrop: /** @type {string | null} */ (null),
    };
  });

  const state = {
    /** @type {boolean} */
    open: false,
    /** @type {string | null} */
    openCategoryId: null,
  };

  buildButton.addEventListener('click', (e) => {
    e.stopPropagation();
    buildButton.blur();
    state.open = !state.open;
    if (!state.open) {
      state.openCategoryId = null;
      deactivateActive();
    }
    syncPanels();
  });
  buildButton.addEventListener('mousedown', (e) => e.stopPropagation());

  // Escape closes the palette. The existing cancel/designator escape is on
  // the document in designator-land; our handler fires first when the palette
  // is open so escape doesn't also deactivate whatever designator was chosen.
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (!state.open && !state.openCategoryId) return;
    state.open = false;
    state.openCategoryId = null;
    deactivateActive();
    syncPanels();
  });

  function deactivateActive() {
    for (const b of buttons) if (b.designator.active) b.designator.deactivate();
  }

  function syncPanels() {
    categoryColumn.style.display = state.open ? 'flex' : 'none';
    designatorColumn.style.display = state.open && state.openCategoryId ? 'flex' : 'none';
    // Category header reflects the active pick so the user always knows which
    // column the designators belong to.
    const activeCat = CATEGORIES.find((c) => c.id === state.openCategoryId);
    designatorColumn.header.textContent = activeCat ? activeCat.label : '';
    for (const cb of categoryButtons) {
      applyCategoryActive(cb.el, cb.id === state.openCategoryId, cb.empty);
    }
    for (const b of buttons) {
      b.el.style.display = b.categoryId === state.openCategoryId ? 'flex' : 'none';
    }
    const activeEmpty = state.openCategoryId !== null && entryCounts[state.openCategoryId] === 0;
    emptyPlaceholder.style.display = activeEmpty ? 'block' : 'none';
    applyBuildActive(buildButton, state.open);
  }

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
      if (b.croppable && b.swatch) {
        const designator = /** @type {CroppableDesignator} */ (b.designator);
        const crop = designator.currentCrop;
        if (crop !== b.lastCrop) {
          applyCropSwatchColor(b.swatch, crop);
          b.lastCrop = crop;
        }
      }
    }
  }

  document.body.appendChild(root);
  syncPanels();

  function toggleOpen() {
    state.open = !state.open;
    if (!state.open) {
      state.openCategoryId = null;
      deactivateActive();
    }
    syncPanels();
  }

  function openCategory(/** @type {string} */ id) {
    if (!CATEGORIES.some((c) => c.id === id)) return;
    if (!state.open) state.open = true;
    state.openCategoryId = state.openCategoryId === id ? null : id;
    deactivateActive();
    syncPanels();
  }

  function activateEntry(/** @type {string} */ id) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return false;
    if (entry.designator.active) entry.designator.deactivate();
    else entry.designator.activate();
    return true;
  }

  // Entry hotkeys are category-scoped — same letter can repeat across tabs.
  function findEntryByHotkey(/** @type {string} */ code) {
    if (!state.openCategoryId) return null;
    return entries.find((e) => e.hotkey === code && e.categoryId === state.openCategoryId) ?? null;
  }

  function findCategoryByHotkey(/** @type {string} */ code) {
    return CATEGORIES.find((c) => c.hotkey === code) ?? null;
  }

  return {
    update,
    root,
    state,
    toggleOpen,
    openCategory,
    activateEntry,
    findEntryByHotkey,
    findCategoryByHotkey,
  };
}

/**
 * @param {string} title
 * @returns {HTMLDivElement & { header: HTMLDivElement, body: HTMLDivElement }}
 */
function makeColumn(title) {
  const col = /** @type {HTMLDivElement & { header: HTMLDivElement, body: HTMLDivElement }} */ (
    document.createElement('div')
  );
  Object.assign(col.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '6px',
    background: 'rgba(14, 18, 24, 0.88)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '6px',
    alignSelf: 'flex-end',
  });
  const header = document.createElement('div');
  Object.assign(header.style, {
    color: '#b5c0cc',
    font: "600 10px/1 system-ui, -apple-system, 'Segoe UI', sans-serif",
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    padding: '2px 2px 4px 2px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
    marginBottom: '2px',
    minHeight: '12px',
  });
  header.textContent = title;
  col.appendChild(header);
  const body = document.createElement('div');
  Object.assign(body.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  });
  col.appendChild(body);
  col.header = header;
  col.body = body;
  return col;
}

/**
 * @param {BuildCategory} cat
 * @param {boolean} empty
 * @returns {HTMLButtonElement}
 */
function makeCategoryButton(cat, empty) {
  const el = document.createElement('button');
  el.type = 'button';
  el.title = empty ? `${cat.label} category (nothing here yet)` : `${cat.label} category`;
  Object.assign(el.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    width: '128px',
    height: '34px',
    padding: '4px 8px',
    background: 'rgba(30, 36, 44, 0.85)',
    color: empty ? '#8a95a3' : '#e6e6e6',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: '4px',
    font: "600 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif",
    cursor: 'pointer',
    boxSizing: 'border-box',
    textAlign: 'left',
    opacity: empty ? '0.55' : '1',
    transition: 'border-color 80ms linear, background-color 80ms linear',
  });
  const icon = document.createElement('span');
  icon.textContent = cat.icon;
  Object.assign(icon.style, { fontSize: '18px', lineHeight: '1' });
  const label = document.createElement('span');
  label.textContent = cat.label;
  el.append(icon, label);
  return el;
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
    alignItems: 'center',
    gap: '8px',
    width: '172px',
    minHeight: '40px',
    padding: '4px 8px',
    background: 'rgba(30, 36, 44, 0.85)',
    color: '#e6e6e6',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    borderRadius: '4px',
    font: "600 12px/1.15 system-ui, -apple-system, 'Segoe UI', sans-serif",
    cursor: 'pointer',
    boxSizing: 'border-box',
    textAlign: 'left',
    transition: 'border-color 80ms linear, background-color 80ms linear',
  });

  const icon = document.createElement('span');
  icon.textContent = entry.icon;
  Object.assign(icon.style, { fontSize: '20px', lineHeight: '1', flex: '0 0 auto' });

  const textCol = document.createElement('span');
  Object.assign(textCol.style, {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minWidth: '0',
  });
  const label = document.createElement('span');
  label.textContent = entry.label;
  textCol.appendChild(label);

  el.append(icon, textCol);

  /** @type {HTMLElement | null} */
  let swatch = null;
  if (entry.stuffed || entry.croppable) {
    swatch = document.createElement('div');
    Object.assign(swatch.style, {
      width: '14px',
      height: '14px',
      borderRadius: '3px',
      background: '#ffffff',
      border: '1px solid rgba(0, 0, 0, 0.35)',
      boxSizing: 'border-box',
      flex: '0 0 auto',
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
  if (entry.croppable) {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.blur();
      openCropPicker(el, /** @type {CroppableDesignator} */ (entry.designator));
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
  swatch.style.background = colorToCss(def.wallColor);
}

/**
 * @param {HTMLElement | null} swatch
 * @param {string} cropKind
 */
function applyCropSwatchColor(swatch, cropKind) {
  if (!swatch) return;
  swatch.style.background = colorToCss(CROP_VISUALS[cropKind].ripeColor);
}

/** @type {HTMLElement | null} */
let openPicker = null;

/**
 * @typedef {Object} PickerEntry
 * @property {string} id
 * @property {string} label
 * @property {number} swatchColor
 * @property {string} [icon]
 *
 * @typedef {Object} PickerOpts
 * @property {HTMLElement} anchor
 * @property {PickerEntry[]} entries
 * @property {string} selectedId
 * @property {(id: string) => void} onSelect
 */

/** @param {PickerOpts} opts */
function openPopupPicker({ anchor, entries, selectedId, onSelect }) {
  closePicker();
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
  for (const entry of entries) {
    const item = document.createElement('button');
    item.type = 'button';
    Object.assign(item.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 6px',
      background: selectedId === entry.id ? 'rgba(80, 100, 120, 0.55)' : 'rgba(30, 36, 44, 0.6)',
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
      background: colorToCss(entry.swatchColor),
      border: '1px solid rgba(0, 0, 0, 0.35)',
      textAlign: 'center',
      lineHeight: '14px',
      fontSize: '12px',
    });
    if (entry.icon) swatch.textContent = entry.icon;
    const name = document.createElement('span');
    name.textContent = entry.label;
    item.append(swatch, name);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(entry.id);
      closePicker();
    });
    item.addEventListener('mousedown', (e) => e.stopPropagation());
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  // Position above the anchor button (the tab sits at the bottom of the
  // screen, so the menu grows up and to the right).
  const rect = anchor.getBoundingClientRect();
  const menuHeight = menu.getBoundingClientRect().height;
  menu.style.left = `${rect.right + 6}px`;
  menu.style.top = `${rect.top - menuHeight + rect.height}px`;
  openPicker = menu;
  // Defer the dismiss-on-outside handler so the contextmenu click that
  // opened the menu doesn't immediately close it.
  setTimeout(() => {
    addEventListener('mousedown', dismissOnOutside, true);
    addEventListener('keydown', dismissOnEscape, true);
  }, 0);
}

/**
 * @param {HTMLElement} anchor
 * @param {StuffedDesignator} designator
 */
function openStuffPicker(anchor, designator) {
  openPopupPicker({
    anchor,
    entries: STUFF_ORDER.map((id) => ({
      id,
      label: STUFF[id].name,
      swatchColor: STUFF[id].wallColor,
    })),
    selectedId: designator.currentStuff,
    onSelect: (id) => designator.setStuff(id),
  });
}

/**
 * @param {HTMLElement} anchor
 * @param {CroppableDesignator} designator
 */
function openCropPicker(anchor, designator) {
  openPopupPicker({
    anchor,
    entries: CROP_KINDS.map((kind) => ({
      id: kind,
      label: CROP_VISUALS[kind].label,
      swatchColor: CROP_VISUALS[kind].ripeColor,
      icon: CROP_VISUALS[kind].icon,
    })),
    selectedId: designator.currentCrop,
    onSelect: (kind) => designator.setCrop(kind),
  });
}

function closePicker() {
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
  closePicker();
}

/** @param {KeyboardEvent} e */
function dismissOnEscape(e) {
  if (e.code === 'Escape') closePicker();
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

/**
 * @param {HTMLElement} el
 * @param {boolean} active
 * @param {boolean} empty
 */
function applyCategoryActive(el, active, empty) {
  if (active) {
    el.style.borderColor = '#b5c0cc';
    el.style.background = empty ? 'rgba(36, 42, 52, 0.9)' : 'rgba(52, 62, 78, 0.92)';
  } else {
    el.style.borderColor = 'rgba(255, 255, 255, 0.14)';
    el.style.background = 'rgba(30, 36, 44, 0.85)';
  }
}

/**
 * @param {HTMLElement} el
 * @param {boolean} active
 */
function applyBuildActive(el, active) {
  if (active) {
    el.style.borderColor = '#ffd070';
    el.style.background = 'rgba(52, 48, 24, 0.95)';
  } else {
    el.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    el.style.background = 'rgba(14, 18, 24, 0.92)';
  }
}
