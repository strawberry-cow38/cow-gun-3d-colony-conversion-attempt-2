/**
 * Selected-stockpile-zone panel. Shows one collapsible section per item
 * category with a per-category master toggle and per-item checkboxes driving
 * the zone's allowed-kinds filter. A delete button removes the zone entirely
 * (caller clears the tile flag + re-posts haul jobs for any evicted items).
 *
 * Mirrors bedPanel/furnacePanel positioning. Shown only when
 * `state.selectedZoneId` is non-null.
 */

import { ITEM_CATEGORIES, ITEM_INFO } from '../world/items.js';

/**
 * @typedef {Object} StockpilePanelOpts
 * @property {import('../boot/input.js').BootState} state
 * @property {ReturnType<typeof import('../systems/stockpileZones.js').createStockpileZones>} stockpileZones
 * @property {(id: number) => void} onDelete
 * @property {() => void} onChange
 */

/** @param {StockpilePanelOpts} opts */
export function createStockpilePanel(opts) {
  const { state, stockpileZones, onDelete, onChange } = opts;

  const root = document.createElement('div');
  root.id = 'stockpile-panel';
  Object.assign(root.style, {
    position: 'fixed',
    right: '8px',
    top: '8px',
    width: '260px',
    padding: '8px 10px',
    background: 'rgba(14, 18, 24, 0.9)',
    border: '1px solid rgba(143, 188, 219, 0.45)',
    borderRadius: '4px',
    color: '#e6e6e6',
    font: "12px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif",
    zIndex: '40',
    pointerEvents: 'auto',
    userSelect: 'none',
    display: 'none',
  });
  root.addEventListener('click', (e) => e.stopPropagation());
  root.addEventListener('mousedown', (e) => e.stopPropagation());

  const title = document.createElement('div');
  Object.assign(title.style, { fontWeight: '700', fontSize: '13px', marginBottom: '6px' });
  title.textContent = 'Stockpile';

  const subtitle = document.createElement('div');
  Object.assign(subtitle.style, { fontSize: '11px', color: '#b5c0cc', marginBottom: '8px' });

  const listWrap = document.createElement('div');
  Object.assign(listWrap.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    maxHeight: '320px',
    overflowY: 'auto',
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.textContent = 'Delete Zone';
  Object.assign(deleteBtn.style, {
    marginTop: '10px',
    padding: '6px 8px',
    background: 'rgba(160, 40, 40, 0.55)',
    border: '1px solid rgba(255, 120, 120, 0.6)',
    borderRadius: '2px',
    color: '#f5e6e6',
    font: 'inherit',
    cursor: 'pointer',
    width: '100%',
  });
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.selectedZoneId != null) onDelete(state.selectedZoneId);
  });

  root.append(title, subtitle, listWrap, deleteBtn);
  document.body.appendChild(root);

  // Category id → whether the collapsible body is expanded. Default expanded
  // so new zones land with everything visible.
  /** @type {Map<string, boolean>} */
  const expanded = new Map();
  for (const c of ITEM_CATEGORIES) expanded.set(c.id, true);

  /** @type {number | null} */
  let currentId = null;

  function update() {
    const id = state.selectedZoneId;
    if (id == null) {
      if (root.style.display !== 'none') root.style.display = 'none';
      currentId = null;
      return;
    }
    const zone = stockpileZones.zoneById(id);
    if (!zone) {
      if (root.style.display !== 'none') root.style.display = 'none';
      currentId = null;
      return;
    }
    if (root.style.display === 'none') root.style.display = '';
    if (currentId !== id) currentId = id;
    subtitle.textContent = `${zone.tiles.size} tile${zone.tiles.size === 1 ? '' : 's'} · filter`;
    rebuildList(zone);
  }

  /** @param {{ id: number, tiles: Set<number>, allowedKinds: Set<string> }} zone */
  function rebuildList(zone) {
    listWrap.replaceChildren();
    for (const cat of ITEM_CATEGORIES) {
      listWrap.append(buildCategoryBlock(zone, cat));
    }
  }

  /**
   * @param {{ id: number, allowedKinds: Set<string> }} zone
   * @param {{ id: string, label: string, kinds: string[] }} cat
   */
  function buildCategoryBlock(zone, cat) {
    const block = document.createElement('div');
    Object.assign(block.style, {
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '2px',
      background: 'rgba(30, 36, 44, 0.8)',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 6px',
      cursor: 'pointer',
    });

    const allowedCount = cat.kinds.filter((k) => zone.allowedKinds.has(k)).length;
    const total = cat.kinds.length;
    const allOn = total > 0 && allowedCount === total;
    const anyOn = allowedCount > 0;

    const masterBox = document.createElement('span');
    masterBox.textContent = allOn ? '☑' : anyOn ? '◪' : '☐';
    Object.assign(masterBox.style, {
      display: 'inline-block',
      width: '14px',
      textAlign: 'center',
      color: allOn ? '#8fbcdb' : anyOn ? '#8fbcdb' : '#6b7785',
    });
    masterBox.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetOn = !allOn;
      for (const kind of cat.kinds) {
        stockpileZones.setAllowed(zone.id, kind, targetOn);
      }
      onChange();
      update();
    });

    const caret = document.createElement('span');
    caret.textContent = expanded.get(cat.id) ? '▾' : '▸';
    Object.assign(caret.style, { color: '#b5c0cc', width: '10px', display: 'inline-block' });

    const label = document.createElement('span');
    label.textContent = cat.label;
    Object.assign(label.style, { flex: '1', fontWeight: '600' });

    const count = document.createElement('span');
    count.textContent = total > 0 ? `${allowedCount}/${total}` : '—';
    Object.assign(count.style, { fontSize: '10px', color: '#b5c0cc' });

    header.append(masterBox, caret, label, count);
    header.addEventListener('click', () => {
      expanded.set(cat.id, !expanded.get(cat.id));
      update();
    });

    const body = document.createElement('div');
    Object.assign(body.style, {
      display: expanded.get(cat.id) && cat.kinds.length > 0 ? 'flex' : 'none',
      flexDirection: 'column',
      padding: '2px 8px 6px 26px',
      gap: '2px',
    });
    for (const kind of cat.kinds) {
      body.append(buildKindRow(zone, kind));
    }

    block.append(header, body);
    return block;
  }

  /**
   * @param {{ id: number, allowedKinds: Set<string> }} zone
   * @param {string} kind
   */
  function buildKindRow(zone, kind) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '2px 4px',
      cursor: 'pointer',
      borderRadius: '2px',
    });
    const on = zone.allowedKinds.has(kind);
    const box = document.createElement('span');
    box.textContent = on ? '☑' : '☐';
    Object.assign(box.style, {
      width: '14px',
      textAlign: 'center',
      color: on ? '#8fbcdb' : '#6b7785',
    });
    const name = document.createElement('span');
    name.textContent = /** @type {any} */ (ITEM_INFO)[kind]?.label ?? kind;
    row.append(box, name);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      stockpileZones.setAllowed(zone.id, kind, !on);
      onChange();
      update();
    });
    return row;
  }

  return { update, root };
}
