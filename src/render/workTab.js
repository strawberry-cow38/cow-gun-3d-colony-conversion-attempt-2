/**
 * Work tab: per-cow work-priority grid anchored at bottom-right.
 *
 * Closed state: a single "Work" button.
 * Open state: a panel rising from the button with a grid —
 *   rows = living cows, cols = the 7 WORK_CATEGORIES.
 *
 * Two display modes:
 *   • 'check'    — click a cell to toggle enabled ↔ disabled
 *                  (enabled = DEFAULT_PRIORITY)
 *   • 'priority' — click cycles 0 → 1 → 2 → … → MAX_PRIORITY → 0
 *
 * A mode toggle button at the top flips between them. Right-click on any cell
 * clears it to 0 regardless of mode.
 */

import {
  DEFAULT_PRIORITY,
  MAX_PRIORITY,
  WORK_CATEGORIES,
  WORK_CATEGORY_LABELS,
} from '../world/workPriorities.js';

/** @typedef {'check' | 'priority'} WorkTabMode */

const CELL_SIZE = 26;
const NAME_COL_WIDTH = 110;

/**
 * Color ramp for priority cells. Lower priority = brighter / warmer. Disabled
 * cells use the `disabled` tone.
 */
const PRIORITY_TONE = {
  disabled: '#3a4048',
  1: '#e06a6a',
  2: '#e0986a',
  3: '#e0c06a',
  4: '#b8d07a',
  5: '#7ad0a0',
  6: '#7ab8d0',
  7: '#8a8fd0',
  8: '#a07ad0',
};

/**
 * @typedef {Object} WorkTabApi
 * @property {() => void} update
 * @property {HTMLElement} root
 * @property {{ open: boolean, mode: WorkTabMode }} state
 * @property {() => void} toggleOpen
 *
 * @typedef {Object} WorkTabOpts
 * @property {import('../ecs/world.js').World} world
 */

/** @param {WorkTabOpts} opts */
export function createWorkTab(opts) {
  const { world } = opts;

  const state = /** @type {{ open: boolean, mode: WorkTabMode }} */ ({
    open: false,
    mode: 'check',
  });
  /** Toggled on when grid-affecting state changes so the frame loop rebuilds
   * the DOM once per dirty interval instead of every frame. */
  let gridDirty = true;

  const root = document.createElement('div');
  root.id = 'work-tab';
  Object.assign(root.style, {
    position: 'fixed',
    bottom: '10px',
    right: '10px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '6px',
    zIndex: '40',
    userSelect: 'none',
  });

  // Popup panel, hidden until open.
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    display: 'none',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px',
    background: 'rgba(14, 18, 24, 0.95)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '6px',
    color: '#e6e6e6',
    font: "500 11px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif",
    maxHeight: '70vh',
    overflowY: 'auto',
  });
  root.appendChild(panel);

  // Header row: title + mode toggle.
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    paddingBottom: '4px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  });
  const title = document.createElement('div');
  title.textContent = 'Work';
  Object.assign(title.style, { fontWeight: '700', fontSize: '13px' });
  header.appendChild(title);

  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  Object.assign(modeBtn.style, {
    padding: '4px 8px',
    background: 'rgba(255, 255, 255, 0.08)',
    color: '#e6e6e6',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '4px',
    font: "600 11px/1.1 system-ui, -apple-system, 'Segoe UI', sans-serif",
    cursor: 'pointer',
  });
  modeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.mode = state.mode === 'check' ? 'priority' : 'check';
    gridDirty = true;
    render();
  });
  modeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  header.appendChild(modeBtn);
  panel.appendChild(header);

  // Grid container — re-populated every render.
  const gridWrap = document.createElement('div');
  panel.appendChild(gridWrap);

  // Root toggle button.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.title = 'Work — assign jobs per cow';
  Object.assign(toggle.style, {
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
  });
  const toggleIcon = document.createElement('div');
  toggleIcon.textContent = '📋';
  Object.assign(toggleIcon.style, { fontSize: '22px', lineHeight: '1' });
  const toggleLabel = document.createElement('div');
  toggleLabel.textContent = 'Work';
  toggle.append(toggleIcon, toggleLabel);
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOpen();
  });
  toggle.addEventListener('mousedown', (e) => e.stopPropagation());
  root.appendChild(toggle);

  function toggleOpen() {
    state.open = !state.open;
    gridDirty = true;
    render();
  }

  // Suppress canvas reactions while the popup is up.
  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  panel.addEventListener('click', (e) => e.stopPropagation());
  panel.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  function render() {
    if (!gridDirty) return;
    panel.style.display = state.open ? 'flex' : 'none';
    toggle.style.borderColor = state.open ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.2)';
    modeBtn.textContent = state.mode === 'check' ? 'Mode: ✓' : 'Mode: 1-8';
    if (state.open) renderGrid();
    gridDirty = false;
  }

  function renderGrid() {
    gridWrap.textContent = '';
    const cows = listCows();
    if (cows.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No colonists';
      Object.assign(empty.style, { padding: '10px', color: '#8a95a3', fontStyle: 'italic' });
      gridWrap.appendChild(empty);
      return;
    }

    const table = document.createElement('div');
    Object.assign(table.style, {
      display: 'grid',
      gridTemplateColumns: `${NAME_COL_WIDTH}px repeat(${WORK_CATEGORIES.length}, ${CELL_SIZE}px)`,
      columnGap: '2px',
      rowGap: '2px',
    });

    // Header row
    const corner = document.createElement('div');
    table.appendChild(corner);
    for (const cat of WORK_CATEGORIES) {
      const th = document.createElement('div');
      th.textContent = WORK_CATEGORY_LABELS[cat];
      th.title = cat;
      Object.assign(th.style, {
        fontSize: '10px',
        textAlign: 'center',
        color: '#a0a8b2',
        transform: 'rotate(-35deg)',
        transformOrigin: 'bottom left',
        height: '44px',
        lineHeight: '1',
        paddingTop: '26px',
      });
      table.appendChild(th);
    }

    // One row per cow
    for (const cow of cows) {
      const name = document.createElement('div');
      name.textContent = cow.name;
      Object.assign(name.style, {
        padding: '4px 6px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '11px',
      });
      table.appendChild(name);
      for (const cat of WORK_CATEGORIES) {
        const cell = makeCell(cow.id, cat);
        table.appendChild(cell);
      }
    }
    gridWrap.appendChild(table);
  }

  /**
   * @param {number} cowId
   * @param {import('../world/workPriorities.js').WorkCategory} cat
   */
  function makeCell(cowId, cat) {
    const wp = world.get(cowId, 'WorkPriorities');
    const current = wp?.priorities?.[cat] ?? 0;
    const cell = document.createElement('button');
    cell.type = 'button';
    const tone = current === 0 ? PRIORITY_TONE.disabled : PRIORITY_TONE[current];
    Object.assign(cell.style, {
      width: `${CELL_SIZE}px`,
      height: `${CELL_SIZE}px`,
      padding: '0',
      background: tone,
      color: current === 0 ? '#6a7380' : '#0e1218',
      border: '1px solid rgba(0, 0, 0, 0.4)',
      borderRadius: '3px',
      font: "700 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif",
      cursor: 'pointer',
      boxSizing: 'border-box',
    });
    if (state.mode === 'check') {
      cell.textContent = current > 0 ? '✓' : '';
    } else {
      cell.textContent = current > 0 ? String(current) : '';
    }
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      setCell(cowId, cat, nextValueOnClick(current));
    });
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setCell(cowId, cat, 0);
    });
    cell.addEventListener('mousedown', (e) => e.stopPropagation());
    return cell;
  }

  /** @param {number} current */
  function nextValueOnClick(current) {
    if (state.mode === 'check') {
      return current > 0 ? 0 : DEFAULT_PRIORITY;
    }
    // priority mode: 0 → 1 → … → MAX → 0
    return current >= MAX_PRIORITY ? 0 : current + 1;
  }

  /**
   * @param {number} cowId
   * @param {import('../world/workPriorities.js').WorkCategory} cat
   * @param {number} value
   */
  function setCell(cowId, cat, value) {
    const wp = world.get(cowId, 'WorkPriorities');
    if (!wp) return;
    if (!wp.priorities) wp.priorities = {};
    if (wp.priorities[cat] === value) return;
    wp.priorities[cat] = value;
    // Nudge the cow's brain to re-plan on its next tick so priority changes
    // apply without waiting for a board-version bump.
    const brain = world.get(cowId, 'Brain');
    if (brain) brain.jobDirty = true;
    gridDirty = true;
    render();
  }

  function listCows() {
    /** @type {{ id: number, name: string }[]} */
    const rows = [];
    for (const { id, components } of world.query(['Cow', 'Identity', 'Brain', 'WorkPriorities'])) {
      const health = world.get(id, 'Health');
      if (health?.dead) continue;
      rows.push({ id, name: components.Brain.name || components.Identity.firstName || '?' });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }

  render();
  document.body.appendChild(root);

  return /** @type {WorkTabApi} */ ({
    root,
    state,
    toggleOpen,
    update() {
      // Gated by gridDirty so the frame loop only rebuilds the grid when
      // something observable changed (click, mode flip, open/close).
      render();
    },
  });
}
