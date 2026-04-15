/**
 * Fixed-position card that describes the currently selected item stack(s).
 *
 * One selection → full card (label, count/capacity, description, forbid
 * toggle). Multiple selections → summary card (kind breakdown + forbid
 * toggle that applies to the whole set). Hidden when nothing is selected.
 *
 * The forbid button mutates `Item.forbidden` directly — no event bus — so
 * callers pass an `onChange` hook that refreshes whatever needs to know
 * (itemInstancer to redraw the X billboard, HUD to update counters).
 */

import { toggleForbiddenOnStacks } from '../boot/utils.js';
import { ITEM_INFO } from '../world/items.js';

/**
 * @typedef {Object} ItemStackPanelOpts
 * @property {import('../ecs/world.js').World} world
 * @property {import('../boot/input.js').BootState} state
 * @property {import('../jobs/board.js').JobBoard} board
 * @property {() => void} onChange
 * @property {(itemId: number, size: number) => void} [onInstall]
 */

/** @param {ItemStackPanelOpts} opts */
export function createItemStackPanel(opts) {
  const { world, state, board, onChange, onInstall } = opts;

  const root = document.createElement('div');
  root.id = 'item-stack-panel';
  Object.assign(root.style, {
    position: 'fixed',
    right: '8px',
    bottom: '8px',
    minWidth: '220px',
    maxWidth: '280px',
    padding: '8px 10px',
    background: 'rgba(14, 18, 24, 0.88)',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    borderRadius: '4px',
    color: '#e6e6e6',
    font: "12px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif",
    zIndex: '40',
    pointerEvents: 'auto',
    userSelect: 'none',
    display: 'none',
  });

  const title = document.createElement('div');
  Object.assign(title.style, {
    fontWeight: '700',
    fontSize: '13px',
    marginBottom: '2px',
  });

  const meta = document.createElement('div');
  Object.assign(meta.style, {
    color: '#b5c0cc',
    marginBottom: '4px',
  });

  const desc = document.createElement('div');
  Object.assign(desc.style, {
    color: '#d8dfe6',
    marginBottom: '8px',
  });

  const forbidBtn = document.createElement('button');
  Object.assign(forbidBtn.style, {
    display: 'block',
    width: '100%',
    padding: '4px 8px',
    background: 'rgba(40, 40, 50, 0.8)',
    border: '1px solid rgba(255, 255, 255, 0.22)',
    borderRadius: '3px',
    color: '#e6e6e6',
    font: 'inherit',
    cursor: 'pointer',
    textAlign: 'center',
  });
  forbidBtn.type = 'button';
  forbidBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleForbidden();
  });

  const installBtn = document.createElement('button');
  Object.assign(installBtn.style, {
    display: 'none',
    width: '100%',
    padding: '4px 8px',
    marginTop: '4px',
    background: 'rgba(60, 70, 100, 0.85)',
    border: '1px solid rgba(255, 216, 96, 0.55)',
    borderRadius: '3px',
    color: '#ffe19a',
    font: 'inherit',
    cursor: 'pointer',
    textAlign: 'center',
  });
  installBtn.type = 'button';
  installBtn.textContent = 'Install';
  installBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!onInstall) return;
    if (state.selectedItems.size !== 1) return;
    const id = /** @type {number} */ (state.selectedItems.values().next().value);
    const p = world.get(id, 'Painting');
    if (!p) return;
    onInstall(id, p.size | 0);
  });

  root.append(title, meta, desc, forbidBtn, installBtn);
  document.body.appendChild(root);

  function toggleForbidden() {
    if (toggleForbiddenOnStacks(world, state.selectedItems, board) === null) return;
    onChange();
  }

  let lastKey = '';

  function update() {
    const n = state.selectedItems.size;
    if (n === 0) {
      if (root.style.display !== 'none') root.style.display = 'none';
      lastKey = '';
      return;
    }
    if (root.style.display === 'none') root.style.display = '';

    let kind = /** @type {string | null} */ (null);
    let totalCount = 0;
    let totalCapacity = 0;
    let forbiddenCount = 0;
    let mixed = false;
    for (const id of state.selectedItems) {
      const item = world.get(id, 'Item');
      if (!item) continue;
      if (kind === null) kind = item.kind;
      else if (item.kind !== kind) mixed = true;
      totalCount += item.count;
      totalCapacity += item.capacity;
      if (item.forbidden === true) forbiddenCount++;
    }

    const label = mixed ? 'Mixed stacks' : (kind && ITEM_INFO[kind]?.label) || kind || 'Item';
    const description = mixed
      ? 'Multiple item kinds selected.'
      : (kind && ITEM_INFO[kind]?.description) || '';
    const allForbidden = forbiddenCount === n;
    const canInstall = !!onInstall && n === 1 && !mixed && kind === 'painting';
    const key = `${n}|${label}|${totalCount}/${totalCapacity}|${forbiddenCount}|${allForbidden ? 'F' : 'U'}|${canInstall ? 'I' : 'N'}`;
    if (key === lastKey) return;
    lastKey = key;

    title.textContent = n === 1 ? label : `${label} · ${n} stacks`;
    meta.textContent =
      n === 1 ? `${totalCount} / ${totalCapacity}` : `total ${totalCount} / ${totalCapacity}`;
    desc.textContent = description;

    if (allForbidden) {
      forbidBtn.textContent = 'Allowed (F)';
      forbidBtn.style.background = 'rgba(140, 60, 60, 0.85)';
      forbidBtn.style.borderColor = 'rgba(255, 140, 140, 0.55)';
    } else {
      forbidBtn.textContent = forbiddenCount > 0 ? 'Forbid all (F)' : 'Forbid (F)';
      forbidBtn.style.background = 'rgba(40, 40, 50, 0.8)';
      forbidBtn.style.borderColor = 'rgba(255, 255, 255, 0.22)';
    }
    installBtn.style.display = canInstall ? 'block' : 'none';
  }

  return { update, root, toggleForbidden };
}
