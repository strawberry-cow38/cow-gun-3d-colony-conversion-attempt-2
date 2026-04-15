/**
 * Colonist info card: shown top-right while a single cow is primary.
 * Reads Identity + Brain + Cow and renders name, gender, age, height, hair.
 *
 * Age is computed from birthTick every update so the number ticks forward
 * live as the sim clock advances.
 *
 * Has a tab bar (Bio / Social). Bio shows demographics + traits; Social
 * reads Opinions + each partner's Brain/Identity and lists relationships
 * sorted by absolute opinion magnitude.
 */

import { ageYears, formatSimBirthday, tickToSimDate } from '../sim/calendar.js';
import { opinionLabel } from '../world/chitchat.js';
import { nameFontFor, nameFontScaleFor, traitDef } from '../world/traits.js';
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

  const backstoryBlock = document.createElement('div');
  Object.assign(backstoryBlock.style, {
    marginTop: '8px',
    padding: '6px 8px',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '3px',
    fontSize: '11px',
    color: '#c8d0d8',
    lineHeight: '1.4',
    display: 'none',
  });
  const childhoodLine = document.createElement('div');
  const professionLine = document.createElement('div');
  Object.assign(professionLine.style, { marginTop: '3px' });
  backstoryBlock.append(childhoodLine, professionLine);

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

  const tabBar = document.createElement('div');
  Object.assign(tabBar.style, {
    display: 'flex',
    gap: '4px',
    margin: '6px 0 6px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
  });
  const bioTab = makeTabButton('Bio');
  const socialTab = makeTabButton('Social');
  tabBar.append(bioTab, socialTab);

  const bioBody = document.createElement('div');
  bioBody.append(stats, backstoryBlock, traitsWrap, traitDetail);

  const socialBody = document.createElement('div');
  Object.assign(socialBody.style, { fontSize: '12px', color: '#d8dfe6' });

  root.append(header, tabBar, bioBody, socialBody);
  document.body.appendChild(root);

  /** @type {'bio'|'social'} */
  let activeTab = 'bio';
  function renderTabState() {
    const isBio = activeTab === 'bio';
    bioBody.style.display = isBio ? 'block' : 'none';
    socialBody.style.display = isBio ? 'none' : 'block';
    setTabActive(bioTab, isBio);
    setTabActive(socialTab, !isBio);
  }
  bioTab.addEventListener('click', () => {
    activeTab = 'bio';
    renderTabState();
    last.socialKey = '';
  });
  socialTab.addEventListener('click', () => {
    activeTab = 'social';
    renderTabState();
    last.socialKey = '';
    update();
  });
  renderTabState();

  /**
   * `pinnedTrait` sticks the detail open across hovers so the tooltip isn't
   * purely ephemeral on touch devices. `socialKey` caches the last-rendered
   * social list signature so switching tabs or bumping opinions doesn't
   * rebuild the DOM every tick.
   *
   * @type {{ key: string, pinnedTrait: string | null, socialKey: string, socialCow: number, socialChats: number }}
   */
  const last = { key: '', pinnedTrait: null, socialKey: '', socialCow: -1, socialChats: -1 };

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
    const childhood = identity.childhood ?? '';
    const profession = identity.profession ?? '';
    const key = `${brain.name}|${identity.gender}|${age}|${identity.heightCm}|${identity.hairColor}|${birthday}|${birthYear}|${traits.join(',')}|${childhood}|${profession}`;
    if (activeTab === 'social') renderSocial(id);
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
    nameEl.style.fontSize = `${14 * nameFontScaleFor(traits)}px`;
    writeJitteredName(nameEl, id, brain.name);
    genderEl.textContent = `${genderLabel(identity.gender)} · ${age} yrs`;

    stats.replaceChildren(
      row('Birthday', `${birthday}, ${birthYear}`),
      row('Height', `${identity.heightCm} cm`),
      hairRow('Hair', identity.hairColor),
    );

    if (childhood || profession) {
      backstoryBlock.style.display = 'block';
      childhoodLine.replaceChildren();
      if (childhood) {
        const tag = document.createElement('span');
        Object.assign(tag.style, { color: '#8fa0af', fontWeight: '600' });
        tag.textContent = 'Grew up: ';
        const body = document.createElement('span');
        Object.assign(body.style, { fontStyle: 'italic' });
        body.textContent = childhood;
        childhoodLine.append(tag, body);
      }
      professionLine.replaceChildren();
      if (profession) {
        const tag = document.createElement('span');
        Object.assign(tag.style, { color: '#8fa0af', fontWeight: '600' });
        tag.textContent = 'Worked as: ';
        const body = document.createElement('span');
        Object.assign(body.style, { fontStyle: 'italic' });
        body.textContent = profession;
        professionLine.append(tag, body);
      }
    } else {
      backstoryBlock.style.display = 'none';
    }

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

  /** @param {number} cowId */
  function renderSocial(cowId) {
    const op = world.get(cowId, 'Opinions');
    if (!op) {
      if (last.socialKey !== 'empty') {
        last.socialKey = 'empty';
        socialBody.replaceChildren(socialEmptyLine('no opinions yet'));
      }
      return;
    }
    // Fast path: same cow + chat counter means nothing has moved; skip the
    // rebuild-signature work entirely. Also handles the render-every-frame
    // case while the Social tab sits open on a stable colony.
    if (last.socialCow === cowId && last.socialChats === op.chats) return;
    last.socialCow = cowId;
    last.socialChats = op.chats;
    /** @type {{ partnerId: number, score: number, name: string, lastText: string, lastTick: number }[]} */
    const entries = [];
    for (const key of Object.keys(op.scores)) {
      const partnerId = Number(key);
      const partnerBrain = world.get(partnerId, 'Brain');
      if (!partnerBrain) continue;
      const rec = op.last?.[partnerId];
      entries.push({
        partnerId,
        score: op.scores[key],
        name: partnerBrain.name,
        lastText: rec?.text ?? '',
        lastTick: rec?.tick ?? 0,
      });
    }
    entries.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    const sig = `${op.chats}|${entries.map((e) => `${e.partnerId}:${Math.round(e.score)}`).join(',')}`;
    if (sig === last.socialKey) return;
    last.socialKey = sig;

    socialBody.replaceChildren();
    const summary = document.createElement('div');
    Object.assign(summary.style, { color: '#9ba6b1', marginBottom: '6px', fontSize: '11px' });
    summary.textContent = `${op.chats} chat${op.chats === 1 ? '' : 's'} · ${entries.length} known`;
    socialBody.appendChild(summary);
    if (entries.length === 0) {
      socialBody.appendChild(socialEmptyLine('has not met anyone yet'));
      return;
    }
    for (const e of entries) socialBody.appendChild(socialRow(e));
  }

  return { update, root };
}

/** @param {string} msg */
function socialEmptyLine(msg) {
  const d = document.createElement('div');
  Object.assign(d.style, { fontSize: '11px', color: '#7a8590', fontStyle: 'italic' });
  d.textContent = msg;
  return d;
}

/**
 * @param {{ score: number, name: string, lastText: string }} entry
 */
function socialRow(entry) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '4px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
  });

  const headRow = document.createElement('div');
  Object.assign(headRow.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '6px',
  });
  const nameEl = document.createElement('span');
  Object.assign(nameEl.style, {
    fontWeight: '600',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  nameEl.textContent = entry.name;
  const scoreEl = document.createElement('span');
  Object.assign(scoreEl.style, {
    fontSize: '11px',
    color: opinionTone(entry.score),
    flex: '0 0 auto',
  });
  scoreEl.textContent = `${Math.round(entry.score)} · ${opinionLabel(entry.score)}`;
  headRow.append(nameEl, scoreEl);

  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'relative',
    height: '4px',
    background: 'rgba(255, 255, 255, 0.08)',
    borderRadius: '2px',
    overflow: 'hidden',
  });
  const fill = document.createElement('div');
  const t = Math.max(-100, Math.min(100, entry.score)) / 100;
  const width = Math.abs(t) * 50;
  Object.assign(fill.style, {
    position: 'absolute',
    top: '0',
    bottom: '0',
    left: t >= 0 ? '50%' : `${50 - width}%`,
    width: `${width}%`,
    background: opinionTone(entry.score),
  });
  const mid = document.createElement('div');
  Object.assign(mid.style, {
    position: 'absolute',
    top: '0',
    bottom: '0',
    left: '50%',
    width: '1px',
    background: 'rgba(255, 255, 255, 0.18)',
  });
  bar.append(fill, mid);

  row.append(headRow, bar);
  if (entry.lastText) {
    const quote = document.createElement('div');
    Object.assign(quote.style, {
      fontSize: '11px',
      color: '#9ba6b1',
      fontStyle: 'italic',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    quote.textContent = entry.lastText;
    row.appendChild(quote);
  }
  return row;
}

/** @param {number} score */
function opinionTone(score) {
  if (score >= 50) return '#7ad07a';
  if (score >= 10) return '#b8d07a';
  if (score > -10) return '#b5c0cc';
  if (score > -50) return '#d0a97a';
  return '#d07a7a';
}

/** @param {string} label */
function makeTabButton(label) {
  const btn = document.createElement('button');
  Object.assign(btn.style, {
    flex: '1 1 auto',
    padding: '4px 6px',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: '#9ba6b1',
    font: 'inherit',
    fontWeight: '600',
    cursor: 'pointer',
  });
  btn.textContent = label;
  return btn;
}

/**
 * @param {HTMLButtonElement} btn
 * @param {boolean} active
 */
function setTabActive(btn, active) {
  btn.style.color = active ? '#e6e6e6' : '#9ba6b1';
  btn.style.borderBottomColor = active ? '#e6e6e6' : 'transparent';
}

/** @param {string} name */
function initialsOf(name) {
  // Strip honorifics ("Dr.", "Mrs.") so the avatar reads as first+last initial.
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => !p.endsWith('.'));
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
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
