/**
 * Selected-bed panel. Shows the bed's current owner and lets the player
 * pick one from the colony roster. Mirrors the furnace/easel/stove panel
 * style — fixed top-right, mutex with other station panels via the shared
 * selection state.
 *
 * Ownership writes straight to Bed.ownerId. Setting it to 0 clears the
 * claim, which lets any tired cow auto-claim the bed again at sleep time.
 */

/**
 * @typedef {Object} BedPanelOpts
 * @property {import('../ecs/world.js').World} world
 * @property {import('../boot/input.js').BootState} state
 * @property {() => void} onChange
 */

/** @param {BedPanelOpts} opts */
export function createBedPanel(opts) {
  const { world, state, onChange } = opts;

  const root = document.createElement('div');
  root.id = 'bed-panel';
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
  Object.assign(title.style, { fontWeight: '700', fontSize: '13px', marginBottom: '6px' });
  title.textContent = 'Bed';

  const ownerLine = document.createElement('div');
  Object.assign(ownerLine.style, {
    fontSize: '11px',
    color: '#b5c0cc',
    marginBottom: '6px',
  });

  const listWrap = document.createElement('div');
  Object.assign(listWrap.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    maxHeight: '260px',
    overflowY: 'auto',
  });

  root.append(title, ownerLine, listWrap);
  document.body.appendChild(root);

  let lastKey = '';

  function update() {
    const selected = state.selectedBeds;
    const n = selected.size;
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
      title.textContent = `${n} beds selected`;
      ownerLine.textContent = 'Select one bed to assign an owner.';
      listWrap.replaceChildren();
      return;
    }

    const id = /** @type {number} */ (state.primaryBed);
    const bed = world.get(id, 'Bed');
    if (!bed) {
      if (lastKey === 'unknown') return;
      lastKey = 'unknown';
      title.textContent = 'Bed';
      ownerLine.textContent = '';
      listWrap.replaceChildren();
      return;
    }

    const cows = collectCows(world);
    const rosterSig = cows.map((c) => `${c.id}:${c.name}`).join(',');
    const key = `one:${id}:${bed.ownerId}:${rosterSig}`;
    if (key === lastKey) return;
    lastKey = key;

    title.textContent = 'Bed · Owner';
    ownerLine.textContent =
      bed.ownerId > 0 ? `Owner: ${nameOf(world, bed.ownerId)}` : 'Owner: Unassigned';

    listWrap.replaceChildren();
    listWrap.append(makeRow('Unassigned', bed.ownerId === 0, () => assign(id, 0)));
    for (const c of cows) {
      listWrap.append(makeRow(c.name, bed.ownerId === c.id, () => assign(id, c.id)));
    }
  }

  /**
   * @param {number} bedId
   * @param {number} cowId
   */
  function assign(bedId, cowId) {
    const bed = world.get(bedId, 'Bed');
    if (!bed) return;
    // If we're reassigning while someone else is mid-sleep here, let their
    // sleep job bail naturally at its next tick (it re-checks ownership).
    bed.ownerId = cowId;
    lastKey = '';
    onChange();
    update();
  }

  /**
   * @param {string} label
   * @param {boolean} active
   * @param {() => void} onClick
   */
  function makeRow(label, active, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = active ? `✓ ${label}` : label;
    Object.assign(b.style, {
      padding: '5px 8px',
      background: active ? 'rgba(143, 188, 219, 0.35)' : 'rgba(40, 40, 50, 0.85)',
      border: active ? '1px solid rgba(143, 188, 219, 0.7)' : '1px solid rgba(255, 255, 255, 0.18)',
      borderRadius: '2px',
      color: '#e6e6e6',
      font: 'inherit',
      cursor: 'pointer',
      textAlign: 'left',
    });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  return { update, root };
}

/** @param {import('../ecs/world.js').World} world */
function collectCows(world) {
  /** @type {{ id: number, name: string }[]} */
  const cows = [];
  for (const { id, components } of world.query(['Cow', 'Brain', 'Identity'])) {
    cows.push({ id, name: components.Identity.name ?? components.Brain.name ?? `#${id}` });
  }
  cows.sort((a, b) => a.name.localeCompare(b.name));
  return cows;
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {number} cowId
 */
function nameOf(world, cowId) {
  const ident = world.get(cowId, 'Identity');
  if (ident?.name) return ident.name;
  const brain = world.get(cowId, 'Brain');
  return brain?.name ?? `#${cowId}`;
}
