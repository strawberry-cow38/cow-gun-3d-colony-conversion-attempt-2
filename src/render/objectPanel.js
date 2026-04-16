/**
 * Generic info card for world objects (trees, boulders, walls, doors,
 * torches, roofs, floors, ...). Reads the primary selected entity's type
 * from `objectTypeFor` and renders the registry's label / description /
 * context orders. Mirrors the chrome of itemStackPanel so it feels native
 * alongside the existing item/station/cow panels.
 *
 * When several entities of the same type are selected, orders apply to the
 * whole set; when the selection is mixed across types, we fall back to a
 * "Mixed" summary card with no orders (clicking the specific type needed is
 * always still an option).
 */

import { objectTypeFor } from '../ui/objectTypes.js';

/**
 * @typedef {Object} ObjectPanelOpts
 * @property {import('../ecs/world.js').World} world
 * @property {import('../boot/input.js').BootState} state
 * @property {import('../jobs/board.js').JobBoard} board
 * @property {import('../world/tileGrid.js').TileGrid} tileGrid
 * @property {{ play: (kind: string) => void }} [audio]
 * @property {() => void} onChange
 */

/** @param {ObjectPanelOpts} opts */
export function createObjectPanel(opts) {
  const { world, state } = opts;

  const root = document.createElement('div');
  root.id = 'object-panel';
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
  Object.assign(title.style, { fontWeight: '700', fontSize: '13px', marginBottom: '2px' });

  const subtitle = document.createElement('div');
  Object.assign(subtitle.style, { color: '#b5c0cc', marginBottom: '4px' });

  const desc = document.createElement('div');
  Object.assign(desc.style, { color: '#d8dfe6', marginBottom: '8px' });

  const orderRow = document.createElement('div');
  Object.assign(orderRow.style, { display: 'flex', flexDirection: 'column', gap: '4px' });

  root.append(title, subtitle, desc, orderRow);
  document.body.appendChild(root);

  // Reused across frames — the board reference is stable for the panel's
  // lifetime, so we don't need to allocate this object every update().
  const info = { board: opts.board };

  /** @type {HTMLButtonElement[]} */
  const buttonPool = [];

  function getButton(i) {
    let btn = buttonPool[i];
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      Object.assign(btn.style, {
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
      buttonPool[i] = btn;
    }
    return btn;
  }

  let lastKey = '';

  function update() {
    const n = state.selectedObjects.size;
    if (n === 0) {
      if (root.style.display !== 'none') root.style.display = 'none';
      lastKey = '';
      return;
    }
    if (root.style.display === 'none') root.style.display = '';

    const primary =
      state.primaryObject ?? /** @type {number} */ (state.selectedObjects.values().next().value);
    const primaryEntry = objectTypeFor(world, primary);
    const label = primaryEntry ? primaryEntry.label(world, primary) : 'Object';
    const subtitleText = primaryEntry?.subtitle?.(world, primary, info) ?? '';
    const descText = primaryEntry ? primaryEntry.description(world, primary, info) : '';

    // Cheap key first: if nothing visible changed, we can skip the rest —
    // especially the per-entity partition + order.enabled() loop below.
    let orderEnabledKey = '';
    if (primaryEntry) {
      for (const order of primaryEntry.orders) {
        let anyEnabled = false;
        for (const id of state.selectedObjects) {
          if (order.enabled(world, id)) {
            anyEnabled = true;
            break;
          }
        }
        orderEnabledKey += `${order.id}:${anyEnabled ? '1' : '0'}|`;
      }
    }
    const key = `${n}|${primaryEntry?.type ?? ''}|${label}|${subtitleText}|${descText}|${orderEnabledKey}`;
    if (key === lastKey) return;
    lastKey = key;

    // Partition the selection by type so we can (a) detect mixed selections
    // and (b) apply orders only to matching ids. Only needed when the key
    // changed — otherwise we'd allocate a Map + arrays every frame.
    /** @type {Map<string, number[]>} */
    const byType = new Map();
    for (const id of state.selectedObjects) {
      const entry = objectTypeFor(world, id);
      if (!entry) continue;
      let arr = byType.get(entry.type);
      if (!arr) {
        arr = [];
        byType.set(entry.type, arr);
      }
      arr.push(id);
    }
    const mixed = byType.size > 1;
    const sameTypeIds = primaryEntry ? (byType.get(primaryEntry.type) ?? []) : [];

    if (mixed) {
      const parts = [];
      for (const [t, arr] of byType) parts.push(`${arr.length} ${t}${arr.length === 1 ? '' : 's'}`);
      title.textContent = `Mixed selection · ${n}`;
      subtitle.textContent = parts.join(', ');
      desc.textContent = 'Select a single kind to issue orders.';
    } else if (primaryEntry) {
      title.textContent = n === 1 ? label : `${label} · ${n}`;
      subtitle.textContent = subtitleText;
      desc.textContent = descText;
    } else {
      title.textContent = 'Unknown object';
      subtitle.textContent = '';
      desc.textContent = '';
    }

    orderRow.replaceChildren();
    if (!mixed && primaryEntry) {
      const orders = primaryEntry.orders;
      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        const anyEnabled = sameTypeIds.some((id) => order.enabled(world, id));
        if (!anyEnabled) continue;
        const btn = getButton(i);
        btn.textContent = order.label;
        btn.onclick = (e) => {
          e.stopPropagation();
          runOrder(order, sameTypeIds);
        };
        orderRow.appendChild(btn);
      }
    }
  }

  /**
   * @param {import('../ui/objectTypes.js').ObjectOrder} order
   * @param {number[]} ids
   */
  function runOrder(order, ids) {
    const applied = order.apply(
      {
        world: opts.world,
        board: opts.board,
        tileGrid: opts.tileGrid,
        audio: opts.audio,
      },
      ids,
    );
    if (applied > 0) {
      opts.audio?.play('command');
      opts.onChange();
      lastKey = '';
      update();
    } else {
      opts.audio?.play('deny');
    }
  }

  return { update, root };
}
