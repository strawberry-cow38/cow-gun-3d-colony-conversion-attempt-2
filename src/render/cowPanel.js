/**
 * Colonist info card: shown top-right while a single cow is primary.
 * Reads Identity + Brain + Cow and renders name, gender, age, height, hair.
 *
 * Age is computed from birthTick every update so the number ticks forward
 * live as the sim clock advances.
 */

import { ageYears, formatSimBirthday, tickToSimDate } from '../sim/calendar.js';
import { nameFontFor, traitDef } from '../world/traits.js';
import { writeJitteredName } from './handwriting.js';

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

  const traitsWrap = document.createElement('div');
  Object.assign(traitsWrap.style, {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    marginTop: '8px',
  });

  const traitDetail = document.createElement('div');
  Object.assign(traitDetail.style, {
    marginTop: '6px',
    padding: '6px 8px',
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '3px',
    fontSize: '11px',
    color: '#c8d0d8',
    lineHeight: '1.35',
    display: 'none',
  });

  root.append(header, stats, traitsWrap, traitDetail);
  document.body.appendChild(root);

  /**
   * `pinnedTrait` sticks the detail open across hovers so the tooltip isn't
   * purely ephemeral on touch devices.
   *
   * @type {{ key: string, pinnedTrait: string | null }}
   */
  const last = { key: '', pinnedTrait: null };

  function hidePanel() {
    root.style.display = 'none';
    last.key = '';
    last.pinnedTrait = null;
    showTraitDetail(null);
  }

  /** @param {string | null} id */
  function showTraitDetail(id) {
    if (!id) {
      traitDetail.style.display = 'none';
      traitDetail.textContent = '';
      return;
    }
    const def = traitDef(id);
    if (!def) {
      traitDetail.style.display = 'none';
      traitDetail.textContent = '';
      return;
    }
    traitDetail.style.display = 'block';
    traitDetail.replaceChildren();
    const head = document.createElement('div');
    Object.assign(head.style, { fontWeight: '700', color: def.chipColor, marginBottom: '2px' });
    head.textContent = def.label;
    const body = document.createElement('div');
    body.textContent = def.description;
    traitDetail.append(head, body);
  }

  function update() {
    const id = state.primaryCow;
    if (id === null || state.selectedCows.size !== 1) {
      if (root.style.display !== 'none') hidePanel();
      return;
    }
    const identity = world.get(id, 'Identity');
    const brain = world.get(id, 'Brain');
    if (!identity || !brain) {
      if (root.style.display !== 'none') hidePanel();
      return;
    }
    const tick = getTick() + (state.tickOffset ?? 0);
    const age = ageYears(identity.birthTick, tick);
    const birthDate = tickToSimDate(identity.birthTick);
    const birthday = formatSimBirthday(birthDate);
    const birthYear = birthDate.getUTCFullYear();
    const traits = identity.traits;
    const key = `${brain.name}|${identity.gender}|${age}|${identity.heightCm}|${identity.hairColor}|${birthday}|${birthYear}|${traits.join(',')}`;
    if (key === last.key) {
      if (root.style.display === 'none') root.style.display = 'block';
      return;
    }
    if (last.pinnedTrait && !traits.includes(last.pinnedTrait)) {
      last.pinnedTrait = null;
      showTraitDetail(null);
    }
    last.key = key;
    root.style.display = 'block';

    avatar.textContent = initialsOf(brain.name);
    avatar.style.background = hueForName(brain.name);
    nameEl.style.fontFamily = nameFontFor(traits);
    writeJitteredName(nameEl, id, brain.name);
    genderEl.textContent = `${genderLabel(identity.gender)} · ${age} yrs`;

    stats.replaceChildren(
      row('Birthday', `${birthday}, ${birthYear}`),
      row('Height', `${identity.heightCm} cm`),
      hairRow('Hair', identity.hairColor),
    );

    traitsWrap.replaceChildren();
    if (traits.length === 0) {
      const empty = document.createElement('div');
      Object.assign(empty.style, { fontSize: '11px', color: '#7a8590', fontStyle: 'italic' });
      empty.textContent = 'no notable traits';
      traitsWrap.appendChild(empty);
    } else {
      for (const tid of traits) {
        const def = traitDef(tid);
        if (!def) continue;
        const chip = makeTraitChip(def, () => {
          last.pinnedTrait = last.pinnedTrait === tid ? null : tid;
          showTraitDetail(last.pinnedTrait);
        });
        chip.addEventListener('mouseenter', () => {
          if (!last.pinnedTrait) showTraitDetail(tid);
        });
        chip.addEventListener('mouseleave', () => {
          if (!last.pinnedTrait) showTraitDetail(null);
        });
        traitsWrap.appendChild(chip);
      }
    }
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
 * @param {import('../world/traits.js').TraitDef} def
 * @param {() => void} onActivate
 */
function makeTraitChip(def, onActivate) {
  const chip = document.createElement('button');
  Object.assign(chip.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    background: 'rgba(255, 255, 255, 0.06)',
    border: `1px solid ${def.chipColor}`,
    borderRadius: '10px',
    color: '#e6e6e6',
    font: 'inherit',
    fontSize: '11px',
    cursor: 'pointer',
    pointerEvents: 'auto',
  });
  chip.title = def.description;
  const dot = document.createElement('span');
  Object.assign(dot.style, {
    display: 'inline-block',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: def.chipColor,
  });
  const label = document.createElement('span');
  label.textContent = def.label;
  chip.append(dot, label);
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    onActivate();
  });
  return chip;
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
