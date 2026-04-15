/**
 * Fixed-position card for the currently selected furnace. Shows its bill list
 * with per-row controls: suspend toggle, count-mode cycle, target ± spinner,
 * reorder ▲▼, and delete. "Add Bill" opens a popup of registered recipes.
 *
 * Multi-select is intentionally unsupported — with more than one furnace
 * selected the panel collapses to a single "select one furnace" hint so the
 * player doesn't accidentally batch-edit bills. That also matches master's
 * request to hide the editor on multi-select.
 *
 * The panel reads and mutates Bills.list directly. No event bus; callers pass
 * an `onChange` hook for anything that needs to re-render (the furnace glow is
 * already driven by a cached `slot.active` via markDirty, so starting/stopping
 * a bill in Phase 3 will need to call furnaceInstancer.markDirty too).
 */

import { ITEM_INFO } from '../world/items.js';
import {
  BILL_COUNT_MODES,
  RECIPES,
  RECIPE_ORDER,
  billProgressLabel,
  nextCountMode,
} from '../world/recipes.js';
import { computeStockByKind } from '../world/stock.js';

/**
 * @typedef {Object} FurnacePanelOpts
 * @property {import('../ecs/world.js').World} world
 * @property {import('../boot/input.js').BootState} state
 * @property {() => void} onChange
 */

/** @param {FurnacePanelOpts} opts */
export function createFurnacePanel(opts) {
  const { world, state, onChange } = opts;

  const root = document.createElement('div');
  root.id = 'furnace-panel';
  Object.assign(root.style, {
    position: 'fixed',
    right: '8px',
    top: '8px',
    width: '280px',
    padding: '8px 10px',
    background: 'rgba(14, 18, 24, 0.9)',
    border: '1px solid rgba(255, 140, 80, 0.35)',
    borderRadius: '4px',
    color: '#e6e6e6',
    font: "12px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif",
    zIndex: '40',
    pointerEvents: 'auto',
    userSelect: 'none',
    display: 'none',
  });
  // Swallow clicks so they don't fall through to canvas handlers (selectors
  // + designators would otherwise clear selection or fire a placement).
  root.addEventListener('click', (e) => e.stopPropagation());
  root.addEventListener('mousedown', (e) => e.stopPropagation());

  const title = document.createElement('div');
  Object.assign(title.style, { fontWeight: '700', fontSize: '13px', marginBottom: '6px' });
  title.textContent = 'Furnace';

  const storedLine = document.createElement('div');
  Object.assign(storedLine.style, {
    fontSize: '11px',
    color: '#b5c0cc',
    marginBottom: '6px',
  });

  const billsWrap = document.createElement('div');
  Object.assign(billsWrap.style, { display: 'flex', flexDirection: 'column', gap: '4px' });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+ Add bill';
  Object.assign(addBtn.style, {
    marginTop: '8px',
    width: '100%',
    padding: '5px 8px',
    background: 'rgba(210, 120, 90, 0.85)',
    border: '1px solid rgba(255, 180, 140, 0.6)',
    borderRadius: '3px',
    color: '#fff',
    font: 'inherit',
    fontWeight: '600',
    cursor: 'pointer',
  });
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openRecipePicker(addBtn);
  });

  root.append(title, storedLine, billsWrap, addBtn);
  document.body.appendChild(root);

  let lastKey = '';
  let lastStoredKey = '';
  let lastStockSig = '';
  // computeStockByKind scans every Item/Inventory/Furnace entity — too heavy
  // to run every render frame. Throttle to ~4 Hz; item counts change on sim
  // ticks (not frames) so a quarter-second UI lag is invisible.
  let stockRefreshCountdown = 0;
  /** Fill div per bill-id for the currently-selected furnace, updated in-place each frame. */
  /** @type {Map<number, HTMLDivElement>} */
  const progressFills = new Map();
  /** Progress label <span> per bill-id, updated when stock changes (untilHave mode). */
  /** @type {Map<number, HTMLSpanElement>} */
  const progressSpans = new Map();

  function update() {
    const n = state.selectedFurnaces.size;
    if (n === 0) {
      if (root.style.display !== 'none') root.style.display = 'none';
      lastKey = '';
      return;
    }
    if (root.style.display === 'none') root.style.display = '';

    if (n > 1) {
      const key = `multi:${n}`;
      if (key === lastKey) return;
      lastKey = key;
      lastStoredKey = '';
      title.textContent = `${n} furnaces selected`;
      storedLine.style.display = 'none';
      billsWrap.replaceChildren();
      const hint = document.createElement('div');
      hint.textContent = 'Select one furnace to edit bills.';
      hint.style.color = '#b5c0cc';
      billsWrap.append(hint);
      addBtn.style.display = 'none';
      return;
    }

    const id = /** @type {number} */ (state.primaryFurnace);
    const bills = world.get(id, 'Bills');
    const furnace = world.get(id, 'Furnace');
    if (!bills) {
      if (lastKey === 'unknown') return;
      lastKey = 'unknown';
      lastStoredKey = '';
      lastStockSig = '';
      title.textContent = 'Furnace';
      storedLine.style.display = 'none';
      billsWrap.replaceChildren();
      progressFills.clear();
      progressSpans.clear();
      return;
    }
    // Key fingerprints everything the panel renders. Bill rows cost a DOM
    // rebuild, so this guard matters — every frame otherwise replaceChildren's.
    // `activeBillId` is in the key so starting/stopping a craft swaps the bar
    // in/out; `workTicksRemaining` is NOT — the fill width is updated in
    // place below so a rebuild isn't needed every tick.
    const billsKey = bills.list
      .map((b) => `${b.id}:${b.suspended ? 'S' : 'R'}:${b.countMode}:${b.target}:${b.done}`)
      .join('|');
    const activeId = furnace?.activeBillId ?? 0;
    const key = `one:${id}:${bills.nextBillId}:${activeId}:${billsKey}`;
    if (key !== lastKey) {
      lastKey = key;
      lastStockSig = '';
      addBtn.style.display = '';
      title.textContent = 'Furnace · Bills';
      billsWrap.replaceChildren();
      progressFills.clear();
      progressSpans.clear();
      if (bills.list.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No bills. Click "Add bill" to queue a recipe.';
        empty.style.color = '#8e98a2';
        empty.style.fontStyle = 'italic';
        billsWrap.append(empty);
        return;
      }
      bills.list.forEach((bill, index) => {
        billsWrap.append(renderBillRow(bills, bill, index, activeId));
      });
    }
    if (furnace && activeId > 0) {
      const fill = progressFills.get(activeId);
      const activeBill = bills.list.find((b) => b.id === activeId);
      const recipe = activeBill ? RECIPES[activeBill.recipeId] : null;
      if (fill && recipe && recipe.workTicks > 0) {
        const p = Math.max(0, Math.min(1, 1 - furnace.workTicksRemaining / recipe.workTicks));
        fill.style.width = `${(p * 100).toFixed(1)}%`;
      }
    }

    // untilHave progress spans refresh on stock change. `excludeActiveCrafts`
    // keeps the displayed number reflecting only what's physically in storage
    // — the active craft's about-to-be-produced units show as the progress
    // bar instead, so counting them here would double-display.
    const hasUntilHave = bills.list.some((b) => b.countMode === 'untilHave');
    if (hasUntilHave) {
      if (stockRefreshCountdown <= 0) {
        stockRefreshCountdown = 15;
        const stockByKind = computeStockByKind(world);
        let sig = '';
        for (const bill of bills.list) {
          if (bill.countMode !== 'untilHave') continue;
          const recipe = RECIPES[bill.recipeId];
          if (!recipe) continue;
          sig += `${bill.id}:${stockByKind.get(recipe.outputKind) ?? 0},`;
        }
        if (sig !== lastStockSig) {
          lastStockSig = sig;
          for (const bill of bills.list) {
            if (bill.countMode !== 'untilHave') continue;
            const span = progressSpans.get(bill.id);
            const recipe = RECIPES[bill.recipeId];
            if (!span || !recipe) continue;
            span.textContent = billProgressLabel(bill, {
              stockOfOutput: stockByKind.get(recipe.outputKind) ?? 0,
            });
          }
        }
      } else {
        stockRefreshCountdown--;
      }
    }

    // Stored contents update independently of the bills-rebuild key so cow
    // deposits don't thrash the bill rows. Outputs (finished products waiting
    // for a haul-out) share the row — master wanted one view of "what's at
    // the furnace right now" regardless of which stage it's in.
    if (furnace) {
      const combined = [...furnace.stored, ...furnace.outputs];
      const storedKey = combined.map((s) => `${s.kind}:${s.count}`).join(',');
      if (storedKey !== lastStoredKey) {
        lastStoredKey = storedKey;
        if (combined.length === 0) {
          storedLine.textContent = 'Stored: empty';
        } else {
          const parts = combined.map((s) => `${s.count} ${ITEM_INFO[s.kind]?.label ?? s.kind}`);
          storedLine.textContent = `Stored: ${parts.join(', ')}`;
        }
        storedLine.style.display = '';
      }
    }
  }

  /**
   * @param {{ list: import('../world/recipes.js').Bill[], nextBillId: number }} bills
   * @param {import('../world/recipes.js').Bill} bill
   * @param {number} index
   * @param {number} activeBillId
   */
  function renderBillRow(bills, bill, index, activeBillId) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '3px',
      padding: '6px 7px',
      background: bill.suspended ? 'rgba(50, 40, 40, 0.7)' : 'rgba(32, 38, 48, 0.7)',
      border: `1px solid ${bill.suspended ? 'rgba(180, 120, 120, 0.35)' : 'rgba(255, 255, 255, 0.12)'}`,
      borderRadius: '3px',
      opacity: bill.suspended ? '0.65' : '1',
    });

    const recipe = RECIPES[bill.recipeId];
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '6px' });
    const label = document.createElement('span');
    label.textContent = recipe?.label ?? bill.recipeId;
    Object.assign(label.style, { flex: '1', fontWeight: '600' });
    const progress = document.createElement('span');
    progress.textContent = billProgressLabel(bill, { recipe });
    Object.assign(progress.style, { color: '#b5c0cc', fontSize: '11px' });
    progressSpans.set(bill.id, progress);
    head.append(label, progress);

    const ingLine = document.createElement('div');
    ingLine.style.color = '#8e98a2';
    ingLine.style.fontSize = '11px';
    if (recipe) {
      const ings = recipe.ingredients
        .map((ing) => `${ing.count} ${ITEM_INFO[ing.kind]?.label ?? ing.kind}`)
        .join(' + ');
      ingLine.textContent = `${ings} → ${recipe.outputCount} ${ITEM_INFO[recipe.outputKind]?.label ?? recipe.outputKind}`;
    }

    const controls = document.createElement('div');
    Object.assign(controls.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      marginTop: '2px',
    });
    controls.append(
      makeIconBtn(bill.suspended ? '▶' : '⏸', bill.suspended ? 'Resume' : 'Suspend', () => {
        bill.suspended = !bill.suspended;
        onChange();
        update();
      }),
      makeCycleBtn(bill),
      makeSpinner(bill),
      spacer(),
      makeIconBtn('▲', 'Move up', () => moveBill(bills, index, -1), index === 0),
      makeIconBtn(
        '▼',
        'Move down',
        () => moveBill(bills, index, 1),
        index === bills.list.length - 1,
      ),
      makeIconBtn('×', 'Delete', () => {
        bills.list.splice(index, 1);
        onChange();
        update();
      }),
    );

    row.append(head, ingLine);
    if (bill.id === activeBillId) {
      const track = document.createElement('div');
      Object.assign(track.style, {
        height: '4px',
        background: 'rgba(0, 0, 0, 0.5)',
        borderRadius: '2px',
        overflow: 'hidden',
        marginTop: '1px',
      });
      const fill = document.createElement('div');
      Object.assign(fill.style, {
        height: '100%',
        width: '0%',
        background: 'rgba(255, 122, 40, 0.95)',
        transition: 'width 120ms linear',
      });
      track.append(fill);
      row.append(track);
      progressFills.set(bill.id, fill);
    }
    row.append(controls);
    return row;
  }

  /**
   * @param {{ list: import('../world/recipes.js').Bill[] }} bills
   * @param {number} i
   * @param {number} dir
   */
  function moveBill(bills, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= bills.list.length) return;
    const [moved] = bills.list.splice(i, 1);
    bills.list.splice(j, 0, moved);
    onChange();
    update();
  }

  /**
   * @param {string} glyph
   * @param {string} tooltip
   * @param {() => void} onClick
   * @param {boolean} [disabled]
   */
  function makeIconBtn(glyph, tooltip, onClick, disabled = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = glyph;
    b.title = tooltip;
    Object.assign(b.style, {
      width: '22px',
      height: '22px',
      padding: '0',
      background: 'rgba(40, 40, 50, 0.8)',
      border: '1px solid rgba(255, 255, 255, 0.22)',
      borderRadius: '3px',
      color: '#e6e6e6',
      font: 'inherit',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? '0.4' : '1',
    });
    if (disabled) b.disabled = true;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!disabled) onClick();
    });
    return b;
  }

  /** @param {import('../world/recipes.js').Bill} bill */
  function makeCycleBtn(bill) {
    const labels = { forever: 'Forever', count: 'Count', untilHave: 'Until ≤' };
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = labels[bill.countMode];
    b.title = `Cycle count mode (${BILL_COUNT_MODES.join(' → ')})`;
    Object.assign(b.style, {
      padding: '0 8px',
      height: '22px',
      background: 'rgba(40, 40, 50, 0.8)',
      border: '1px solid rgba(255, 255, 255, 0.22)',
      borderRadius: '3px',
      color: '#e6e6e6',
      font: 'inherit',
      cursor: 'pointer',
      minWidth: '64px',
    });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      bill.countMode = nextCountMode(bill.countMode);
      if (bill.countMode === 'forever') bill.done = 0;
      onChange();
      update();
    });
    return b;
  }

  /** @param {import('../world/recipes.js').Bill} bill */
  function makeSpinner(bill) {
    const wrap = document.createElement('span');
    Object.assign(wrap.style, { display: 'inline-flex', alignItems: 'center', gap: '2px' });
    if (bill.countMode === 'forever') {
      const placeholder = document.createElement('span');
      placeholder.textContent = '';
      placeholder.style.minWidth = '52px';
      wrap.append(placeholder);
      return wrap;
    }
    const step = bill.countMode === 'untilHave' ? 5 : 1;
    const down = makeIconBtn('−', 'Decrease target', () => {
      bill.target = Math.max(step, bill.target - step);
      onChange();
      update();
    });
    const val = document.createElement('span');
    val.textContent = String(bill.target);
    Object.assign(val.style, {
      minWidth: '28px',
      textAlign: 'center',
      font: 'inherit',
      fontVariantNumeric: 'tabular-nums',
    });
    const up = makeIconBtn('+', 'Increase target', () => {
      bill.target += step;
      onChange();
      update();
    });
    wrap.append(down, val, up);
    return wrap;
  }

  function spacer() {
    const s = document.createElement('span');
    s.style.flex = '1';
    return s;
  }

  /** @param {HTMLElement} anchor */
  function openRecipePicker(anchor) {
    const existing = document.getElementById('furnace-recipe-picker');
    if (existing) {
      existing.remove();
      return;
    }
    const popup = document.createElement('div');
    popup.id = 'furnace-recipe-picker';
    const r = anchor.getBoundingClientRect();
    Object.assign(popup.style, {
      position: 'fixed',
      left: `${r.left}px`,
      top: `${r.bottom + 4}px`,
      minWidth: `${r.width}px`,
      padding: '4px',
      background: 'rgba(18, 22, 28, 0.96)',
      border: '1px solid rgba(255, 255, 255, 0.22)',
      borderRadius: '3px',
      zIndex: '41',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
    });
    for (const recipeId of RECIPE_ORDER) {
      const rec = RECIPES[recipeId];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = rec.label;
      Object.assign(btn.style, {
        padding: '5px 8px',
        background: 'rgba(40, 40, 50, 0.85)',
        border: '1px solid rgba(255, 255, 255, 0.18)',
        borderRadius: '2px',
        color: '#e6e6e6',
        font: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        addBill(recipeId);
        popup.remove();
      });
      popup.append(btn);
    }
    document.body.append(popup);
    const teardown = () => {
      popup.remove();
      window.removeEventListener('mousedown', dismiss, true);
      window.removeEventListener('keydown', keyDismiss);
    };
    const dismiss = (/** @type {MouseEvent} */ e) => {
      const t = /** @type {Node} */ (e.target);
      // Clicks inside the popup pick a recipe. Clicks on the Add button
      // re-toggle — let the button handler run and decide to close.
      if (popup.contains(t) || anchor.contains(t)) return;
      teardown();
    };
    const keyDismiss = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') teardown();
    };
    // Defer binding so the opening click doesn't immediately dismiss.
    setTimeout(() => {
      window.addEventListener('mousedown', dismiss, true);
      window.addEventListener('keydown', keyDismiss);
    }, 0);
  }

  /** @param {string} recipeId */
  function addBill(recipeId) {
    const id = state.primaryFurnace;
    if (id === null) return;
    const bills = world.get(id, 'Bills');
    if (!bills) return;
    bills.list.push({
      id: bills.nextBillId++,
      recipeId,
      suspended: false,
      countMode: 'forever',
      target: 10,
      done: 0,
    });
    onChange();
    update();
  }

  return { update, root };
}
