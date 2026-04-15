/**
 * Right-click context menu for single-cow commands.
 *
 * Opened from CowMoveCommand when the player right-click-releases (no drag)
 * with exactly one cow selected. Lists "Move here" plus one
 * "Prioritize <verb>" entry per open board job on the clicked tile.
 *
 * Dismisses on Escape, outside-click, or after any entry is clicked. The
 * menu is clamped to stay inside the viewport so it doesn't disappear off
 * the right/bottom edge when the player clicks near the screen border.
 */

/**
 * @typedef MenuItem
 * @property {string} label
 * @property {() => void} [onPick]
 * @property {boolean} [disabled]  informational, unclickable entry
 */

const BG = '#1a1a1a';
const BORDER = '#3a3a3a';
const HOVER_BG = '#2d3a2d';
const DISABLED_FG = '#777';

export function createPrioritizeMenu() {
  const root = document.createElement('div');
  root.id = 'cow-context-menu';
  Object.assign(root.style, {
    position: 'fixed',
    minWidth: '160px',
    background: BG,
    border: `1px solid ${BORDER}`,
    borderRadius: '3px',
    padding: '3px 0',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '13px',
    color: '#ddd',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
    zIndex: '100',
    userSelect: 'none',
    display: 'none',
  });
  document.body.appendChild(root);

  let visible = false;

  function hide() {
    if (!visible) return;
    visible = false;
    root.style.display = 'none';
    root.innerHTML = '';
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {MenuItem[]} items
   */
  function show(clientX, clientY, items) {
    if (items.length === 0) return;
    root.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        padding: '6px 14px',
        cursor: item.disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
        color: item.disabled ? DISABLED_FG : '',
        fontStyle: item.disabled ? 'italic' : '',
      });
      row.textContent = item.label;
      if (!item.disabled) {
        row.addEventListener('mouseenter', () => {
          row.style.background = HOVER_BG;
        });
        row.addEventListener('mouseleave', () => {
          row.style.background = '';
        });
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          hide();
          item.onPick?.();
        });
      }
      root.appendChild(row);
    }
    visible = true;
    root.style.display = 'block';
    // Position after attach so offsetWidth/Height report real sizes.
    root.style.left = '0px';
    root.style.top = '0px';
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const vw = innerWidth;
    const vh = innerHeight;
    const x = Math.min(clientX, vw - w - 4);
    const y = Math.min(clientY, vh - h - 4);
    root.style.left = `${Math.max(0, x)}px`;
    root.style.top = `${Math.max(0, y)}px`;
  }

  // Dismiss on outside click (capture phase so we beat canvas selection).
  addEventListener(
    'mousedown',
    (e) => {
      if (!visible) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      hide();
    },
    true,
  );
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && visible) hide();
  });
  // Suppress the native browser context menu. RtsCamera already does this on
  // the canvas, but contextmenu fires AFTER mouseup — by the time it fires,
  // our menu has appeared under the cursor, the event's target is the menu
  // (not the canvas), so the canvas listener doesn't match and the browser
  // menu leaks through. Catch it on our root + on window as a belt-and-
  // braces fallback for overlay elements that may be under the cursor at
  // click time.
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('contextmenu', (e) => {
    if (visible) e.preventDefault();
  });

  return {
    show,
    hide,
    get visible() {
      return visible;
    },
  };
}
