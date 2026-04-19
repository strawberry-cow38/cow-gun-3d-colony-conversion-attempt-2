/**
 * Selected-stair info panel. Shows direction, material, and the layer pair
 * the stair connects, plus a Deconstruct / Cancel deconstruct button. Mirrors
 * bedPanel's chrome so it sits in the same top-right slot.
 *
 * Stair lives in `state.selectedStairs` (a station-style selection), not in
 * `state.selectedObjects`, because its hitbox is a rotated 5-tile bbox owned
 * by stationSelectionViz. The deconstruct order posts the same 'deconstruct'
 * job kind the rect designator uses — runDeconstructJob in cow.js handles
 * the rest.
 */

const FACING_NAMES = ['South', 'East', 'North', 'West'];

/**
 * @typedef {Object} StairPanelOpts
 * @property {import('../ecs/world.js').World} world
 * @property {import('../boot/input.js').BootState} state
 * @property {import('../jobs/board.js').JobBoard} board
 * @property {{ play: (kind: string) => void }} [audio]
 * @property {() => void} onChange
 */

/** @param {StairPanelOpts} opts */
export function createStairPanel(opts) {
  const { world, state, board, audio, onChange } = opts;

  const root = document.createElement('div');
  root.id = 'stair-panel';
  Object.assign(root.style, {
    position: 'fixed',
    right: '8px',
    top: '8px',
    width: '240px',
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
  Object.assign(title.style, { fontWeight: '700', fontSize: '13px', marginBottom: '4px' });

  const subtitle = document.createElement('div');
  Object.assign(subtitle.style, { color: '#b5c0cc', marginBottom: '4px' });

  const desc = document.createElement('div');
  Object.assign(desc.style, { color: '#d8dfe6', marginBottom: '8px' });

  const button = document.createElement('button');
  button.type = 'button';
  Object.assign(button.style, {
    display: 'block',
    width: '100%',
    padding: '5px 8px',
    background: 'rgba(40, 40, 50, 0.85)',
    border: '1px solid rgba(255, 255, 255, 0.22)',
    borderRadius: '3px',
    color: '#e6e6e6',
    font: 'inherit',
    cursor: 'pointer',
    textAlign: 'center',
  });
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    runAction();
  });

  root.append(title, subtitle, desc, button);
  document.body.appendChild(root);

  let lastKey = '';

  function update() {
    const selected = state.selectedStairs;
    const n = selected.size;
    if (n === 0) {
      if (root.style.display !== 'none') root.style.display = 'none';
      lastKey = '';
      return;
    }
    if (root.style.display === 'none') root.style.display = '';

    let anyMarked = false;
    let anyUnmarked = false;
    for (const id of selected) {
      const s = world.get(id, 'Stair');
      if (!s) continue;
      if (s.deconstructJobId > 0) anyMarked = true;
      else anyUnmarked = true;
    }
    const action = anyUnmarked ? 'mark' : anyMarked ? 'cancel' : 'mark';

    if (n > 1) {
      const key = `multi:${n}:${action}`;
      if (key === lastKey) return;
      lastKey = key;
      title.textContent = `${n} stairs selected`;
      subtitle.textContent = '';
      desc.textContent = 'Apply orders to the whole group.';
      button.textContent = action === 'cancel' ? 'Cancel deconstruct' : 'Deconstruct';
      button.dataset.action = action;
      return;
    }

    const id = /** @type {number} */ (state.primaryStair);
    const stair = world.get(id, 'Stair');
    if (!stair) {
      if (lastKey === 'unknown') return;
      lastKey = 'unknown';
      title.textContent = 'Stair';
      subtitle.textContent = '';
      desc.textContent = '';
      button.style.display = 'none';
      return;
    }
    button.style.display = '';

    const facingName = FACING_NAMES[stair.facing | 0] ?? 'South';
    const stuffName = stair.stuff === 'stone' ? 'Stone' : 'Wooden';
    const bottomZ = stair.bottomZ | 0;
    const key = `one:${id}:${stair.stuff}:${stair.facing}:${bottomZ}:${stair.deconstructJobId}`;
    if (key === lastKey) return;
    lastKey = key;

    title.textContent = `${stuffName} stair`;
    subtitle.textContent = `Facing ${facingName} · connects Z${bottomZ} → Z${bottomZ + 1}`;
    desc.textContent =
      stair.deconstructJobId > 0
        ? 'Marked for deconstruction. Cancel to keep.'
        : 'A 5-tile staircase. Deconstructing returns half the wood.';
    button.textContent = stair.deconstructJobId > 0 ? 'Cancel deconstruct' : 'Deconstruct';
    button.dataset.action = stair.deconstructJobId > 0 ? 'cancel' : 'mark';
  }

  function runAction() {
    const action = button.dataset.action ?? 'mark';
    let n = 0;
    for (const id of state.selectedStairs) {
      const stair = world.get(id, 'Stair');
      const anchor = world.get(id, 'TileAnchor');
      if (!stair || !anchor) continue;
      if (action === 'mark') {
        if (stair.deconstructJobId > 0) continue;
        const job = board.post('deconstruct', {
          entityId: id,
          kind: 'stair',
          i: anchor.i,
          j: anchor.j,
        });
        stair.deconstructJobId = job.id;
        stair.progress = 0;
        n++;
      } else {
        if (stair.deconstructJobId === 0) continue;
        board.complete(stair.deconstructJobId);
        stair.deconstructJobId = 0;
        stair.progress = 0;
        n++;
      }
    }
    if (n > 0) {
      audio?.play('command');
      onChange();
      lastKey = '';
      update();
    } else {
      audio?.play('deny');
    }
  }

  return { update, root };
}
