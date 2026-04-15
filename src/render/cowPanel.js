/**
 * Colonist info card: shown top-right while a single cow is primary.
 * Reads Identity + Brain + Cow and renders name, gender, age, height, hair.
 *
 * Age is computed from birthTick every update so the number ticks forward
 * live as the sim clock advances.
 */

import { ageYears, formatSimBirthday, tickToSimDate } from '../sim/calendar.js';

/**
 * @typedef {Object} CowPanelOpts
 * @property {import('../ecs/world.js').World} world
 * @property {import('../boot/input.js').BootState} state
 * @property {() => number} getTick
 */

/** @param {CowPanelOpts} opts */
export function createCowPanel(opts) {
  const { world, state, getTick } = opts;

  const root = document.createElement('div');
  root.id = 'cow-panel';
  Object.assign(root.style, {
    position: 'fixed',
    right: '8px',
    top: '8px',
    width: '240px',
    padding: '8px 10px',
    background: 'rgba(14, 18, 24, 0.9)',
    border: '1px solid rgba(255, 255, 255, 0.22)',
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

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  });

  const avatar = document.createElement('div');
  Object.assign(avatar.style, {
    width: '32px',
    height: '32px',
    flex: '0 0 32px',
    borderRadius: '50%',
    color: '#111',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '700',
    fontSize: '13px',
    letterSpacing: '0.5px',
    textShadow: '0 1px 0 rgba(255, 255, 255, 0.35)',
  });

  const headerText = document.createElement('div');
  Object.assign(headerText.style, {
    display: 'flex',
    flexDirection: 'column',
    minWidth: '0',
    flex: '1 1 auto',
  });

  const nameEl = document.createElement('div');
  Object.assign(nameEl.style, {
    fontWeight: '700',
    fontSize: '14px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  const genderEl = document.createElement('div');
  Object.assign(genderEl.style, {
    fontSize: '12px',
    color: '#b5c0cc',
  });

  headerText.append(nameEl, genderEl);
  header.append(avatar, headerText);

  const stats = document.createElement('div');
  Object.assign(stats.style, {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    columnGap: '8px',
    rowGap: '3px',
    fontSize: '12px',
    color: '#d8dfe6',
  });

  root.append(header, stats);
  document.body.appendChild(root);

  /**
   * Bookkeeping for change-detection so we don't rewrite DOM every frame.
   * @type {{ key: string }}
   */
  const last = { key: '' };

  function update() {
    const id = state.primaryCow;
    if (id === null || state.selectedCows.size !== 1) {
      if (root.style.display !== 'none') {
        root.style.display = 'none';
        last.key = '';
      }
      return;
    }
    const identity = world.get(id, 'Identity');
    const brain = world.get(id, 'Brain');
    if (!identity || !brain) {
      if (root.style.display !== 'none') {
        root.style.display = 'none';
        last.key = '';
      }
      return;
    }
    const tick = getTick() + (state.tickOffset ?? 0);
    const age = ageYears(identity.birthTick, tick);
    const birthDate = tickToSimDate(identity.birthTick);
    const birthday = formatSimBirthday(birthDate);
    const birthYear = birthDate.getUTCFullYear();
    const key = `${brain.name}|${identity.gender}|${age}|${identity.heightCm}|${identity.hairColor}|${birthday}|${birthYear}`;
    if (key === last.key) {
      if (root.style.display === 'none') root.style.display = 'block';
      return;
    }
    last.key = key;
    root.style.display = 'block';

    avatar.textContent = initialsOf(brain.name);
    avatar.style.background = hueForName(brain.name);
    nameEl.textContent = brain.name;
    genderEl.textContent = `${genderLabel(identity.gender)} · ${age} yrs`;

    stats.replaceChildren(
      row('Birthday', `${birthday}, ${birthYear}`),
      row('Height', `${identity.heightCm} cm`),
      hairRow('Hair', identity.hairColor),
    );
  }

  return { update, root };
}

/** @param {string} name */
function initialsOf(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** @param {string} name */
function hueForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 72%)`;
}

/** @param {'male' | 'female' | 'nonbinary'} g */
function genderLabel(g) {
  if (g === 'male') return '♂ male';
  if (g === 'female') return '♀ female';
  return '⚪ nonbinary';
}

/**
 * @param {string} label
 * @param {string} value
 */
function row(label, value) {
  const l = document.createElement('div');
  l.textContent = label;
  l.style.color = '#9ba6b1';
  const v = document.createElement('div');
  v.textContent = value;
  const frag = document.createDocumentFragment();
  frag.append(l, v);
  return frag;
}

/**
 * @param {string} label
 * @param {string} color
 */
function hairRow(label, color) {
  const l = document.createElement('div');
  l.textContent = label;
  l.style.color = '#9ba6b1';
  const v = document.createElement('div');
  Object.assign(v.style, { display: 'flex', alignItems: 'center', gap: '6px' });
  const swatch = document.createElement('span');
  Object.assign(swatch.style, {
    display: 'inline-block',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: color,
    border: '1px solid rgba(255, 255, 255, 0.25)',
    flex: '0 0 14px',
  });
  const text = document.createElement('span');
  text.textContent = color;
  v.append(swatch, text);
  const frag = document.createDocumentFragment();
  frag.append(l, v);
  return frag;
}
