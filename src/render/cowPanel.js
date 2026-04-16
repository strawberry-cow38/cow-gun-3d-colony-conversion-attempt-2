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
import {
  CAPACITIES,
  HUMAN_ANATOMY,
  computeCapacities,
  partHp,
  partHpRatio,
  totalBleedRate,
} from '../world/anatomy.js';
import { getProfessionDescription } from '../world/backstories.js';
import { opinionLabel } from '../world/chitchat.js';
import { MAX_LEVEL, SKILL_IDS, SKILL_LABELS, xpForNextLevel } from '../world/skills.js';
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

  // Always-visible needs block: hunger + tiredness bars + the cow's assigned
  // bed. Sits above the tab bar so vitals stay visible no matter which tab
  // the player has open.
  const needsBlock = document.createElement('div');
  Object.assign(needsBlock.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    margin: '6px 0 2px',
    fontSize: '11px',
    color: '#c8d0d8',
  });
  const hungerBar = createNeedBar('Hunger', '#f4c860');
  const tirednessBar = createNeedBar('Tiredness', '#8fbcdb');
  const bedLine = document.createElement('div');
  Object.assign(bedLine.style, { marginTop: '2px', color: '#b5c0cc' });
  needsBlock.append(hungerBar.root, tirednessBar.root, bedLine);

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
  const skillsTab = makeTabButton('Skills');
  const medicalTab = makeTabButton('Health');
  const socialTab = makeTabButton('Social');
  tabBar.append(bioTab, skillsTab, medicalTab, socialTab);

  const bioBody = document.createElement('div');
  bioBody.append(stats, backstoryBlock, traitsWrap, traitDetail);

  const medicalBody = document.createElement('div');
  Object.assign(medicalBody.style, { fontSize: '12px', color: '#d8dfe6' });

  const skillsBody = document.createElement('div');
  Object.assign(skillsBody.style, { fontSize: '12px', color: '#d8dfe6' });

  const socialBody = document.createElement('div');
  Object.assign(socialBody.style, { fontSize: '12px', color: '#d8dfe6' });

  root.append(header, needsBlock, tabBar, bioBody, skillsBody, medicalBody, socialBody);
  document.body.appendChild(root);

  /** @type {'bio'|'skills'|'medical'|'social'} */
  let activeTab = 'bio';
  function renderTabState() {
    bioBody.style.display = activeTab === 'bio' ? 'block' : 'none';
    skillsBody.style.display = activeTab === 'skills' ? 'block' : 'none';
    medicalBody.style.display = activeTab === 'medical' ? 'block' : 'none';
    socialBody.style.display = activeTab === 'social' ? 'block' : 'none';
    setTabActive(bioTab, activeTab === 'bio');
    setTabActive(skillsTab, activeTab === 'skills');
    setTabActive(medicalTab, activeTab === 'medical');
    setTabActive(socialTab, activeTab === 'social');
  }
  bioTab.addEventListener('click', () => {
    activeTab = 'bio';
    renderTabState();
    last.socialKey = '';
    last.medicalKey = '';
    last.skillsKey = '';
  });
  skillsTab.addEventListener('click', () => {
    activeTab = 'skills';
    renderTabState();
    last.skillsKey = '';
    update();
  });
  medicalTab.addEventListener('click', () => {
    activeTab = 'medical';
    renderTabState();
    last.medicalKey = '';
    update();
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
   * @type {{ key: string, pinnedTrait: string | null, socialKey: string, socialCow: number, socialChats: number, medicalKey: string, skillsKey: string }}
   */
  const last = {
    key: '',
    pinnedTrait: null,
    socialKey: '',
    socialCow: -1,
    socialChats: -1,
    medicalKey: '',
    skillsKey: '',
  };

  function hidePanel() {
    root.style.display = 'none';
    last.key = '';
    last.pinnedTrait = null;
    showTraitDetail(null);
  }

  /**
   * Walk the Bed query once to find the bed owned by this cow. O(n) but n is
   * the colony bed count, which stays small, and we only pay it once per panel
   * update (one cow primary at a time).
   * @param {number} cowId
   */
  function updateBedLine(cowId) {
    let ownedAnchor = null;
    for (const { components } of world.query(['Bed', 'TileAnchor'])) {
      if (components.Bed.ownerId === cowId) {
        ownedAnchor = components.TileAnchor;
        break;
      }
    }
    if (ownedAnchor) {
      bedLine.textContent = `Bed: assigned @ ${ownedAnchor.i},${ownedAnchor.j}`;
      bedLine.style.color = '#b5c0cc';
    } else {
      bedLine.textContent = 'Bed: none (floor-sleep)';
      bedLine.style.color = '#e29999';
    }
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
    // Needs bars tick every update — values change continuously, so no cache
    // key gate. Setting style.width is a cheap op the browser batches.
    const hunger = world.get(id, 'Hunger');
    const tiredness = world.get(id, 'Tiredness');
    if (hunger) hungerBar.update(hunger.value);
    if (tiredness) tirednessBar.update(tiredness.value);
    updateBedLine(id);
    if (activeTab === 'social') renderSocial(id);
    if (activeTab === 'medical') renderMedical(id);
    if (activeTab === 'skills') renderSkills(id);
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
      fillBackstoryLine(childhoodLine, 'Grew up: ', childhood);
      fillBackstoryLine(professionLine, 'Worked as: ', profession);
      const desc = profession ? getProfessionDescription(profession) : null;
      if (desc) {
        professionLine.title = `${brain.name} worked as ${articleFor(profession)} ${profession}, ${desc}.`;
      } else {
        professionLine.removeAttribute('title');
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
  function renderSkills(cowId) {
    const skills = world.get(cowId, 'Skills');
    if (!skills) {
      if (last.skillsKey !== 'empty') {
        last.skillsKey = 'empty';
        skillsBody.replaceChildren(medicalEmptyLine('no skill data'));
      }
      return;
    }
    const sig = SKILL_IDS.map((id) => {
      const e = skills.levels?.[id];
      return `${id}:${e?.level ?? 0}:${Math.round(e?.xp ?? 0)}`;
    }).join('|');
    if (sig === last.skillsKey) return;
    last.skillsKey = sig;
    skillsBody.replaceChildren();
    skillsBody.appendChild(medicalSectionHeader('Skills'));
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: 'auto auto 1fr',
      columnGap: '8px',
      rowGap: '3px',
      fontSize: '11px',
      alignItems: 'center',
    });
    for (const id of SKILL_IDS) {
      const entry = skills.levels?.[id] ?? { level: 0, xp: 0 };
      const name = document.createElement('span');
      name.textContent = SKILL_LABELS[id];
      name.style.color = '#9ba6b1';
      const lvl = document.createElement('span');
      Object.assign(lvl.style, {
        color: skillTone(entry.level),
        fontVariantNumeric: 'tabular-nums',
        fontWeight: '600',
      });
      lvl.textContent = String(entry.level);
      const barWrap = document.createElement('div');
      Object.assign(barWrap.style, {
        position: 'relative',
        height: '6px',
        background: 'rgba(255,255,255,0.08)',
        borderRadius: '2px',
        overflow: 'hidden',
      });
      const need = xpForNextLevel(entry.level);
      const pct = entry.level >= MAX_LEVEL ? 1 : Math.max(0, Math.min(1, entry.xp / need));
      const fill = document.createElement('div');
      Object.assign(fill.style, {
        position: 'absolute',
        inset: '0',
        width: `${Math.round(pct * 100)}%`,
        background: skillTone(entry.level),
      });
      barWrap.appendChild(fill);
      barWrap.title =
        entry.level >= MAX_LEVEL
          ? 'mastered'
          : `${Math.round(entry.xp)} / ${need} xp to level ${entry.level + 1}`;
      grid.append(name, lvl, barWrap);
    }
    skillsBody.appendChild(grid);
  }

  /** @param {number} cowId */
  function renderMedical(cowId) {
    const health = world.get(cowId, 'Health');
    if (!health) {
      if (last.medicalKey !== 'empty') {
        last.medicalKey = 'empty';
        medicalBody.replaceChildren(medicalEmptyLine('no health record'));
      }
      return;
    }
    // Sig captures everything the panel shows. Injury ids are cow-local, so
    // prefix with cowId — otherwise switching between two cows who both own an
    // id:1 injury would falsely hit the cache.
    const sig = `${cowId}|${health.dead ? 1 : 0}|${health.injuries
      .map((i) => `${i.id}:${i.severity.toFixed(1)}:${i.tended ? 1 : 0}:${i.infection.toFixed(2)}`)
      .join(',')}`;
    if (sig === last.medicalKey) return;
    last.medicalKey = sig;

    medicalBody.replaceChildren();

    const status = document.createElement('div');
    Object.assign(status.style, {
      fontSize: '11px',
      marginBottom: '6px',
      color: health.dead ? '#d07a7a' : health.injuries.length === 0 ? '#7ad07a' : '#d0a97a',
      fontWeight: '600',
    });
    const bleed = totalBleedRate(health.injuries);
    const statusText = health.dead
      ? 'Deceased'
      : health.injuries.length === 0
        ? 'Healthy'
        : bleed > 0
          ? 'Injured · bleeding'
          : 'Injured';
    status.textContent = statusText;
    medicalBody.appendChild(status);

    medicalBody.appendChild(medicalSectionHeader('Capacities'));
    const caps = computeCapacities(health.injuries);
    const capGrid = document.createElement('div');
    Object.assign(capGrid.style, {
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      columnGap: '6px',
      rowGap: '2px',
      fontSize: '11px',
      marginBottom: '8px',
    });
    for (const cap of CAPACITIES) {
      const v = caps[cap];
      const label = document.createElement('span');
      label.textContent = capacityLabel(cap);
      label.style.color = '#9ba6b1';
      const bar = document.createElement('div');
      Object.assign(bar.style, {
        position: 'relative',
        height: '6px',
        background: 'rgba(255, 255, 255, 0.08)',
        borderRadius: '2px',
        overflow: 'hidden',
        alignSelf: 'center',
      });
      const fill = document.createElement('div');
      Object.assign(fill.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        bottom: '0',
        width: `${Math.round(v * 100)}%`,
        background: capacityTone(v),
      });
      bar.appendChild(fill);
      const pct = document.createElement('span');
      Object.assign(pct.style, { color: capacityTone(v), fontVariantNumeric: 'tabular-nums' });
      pct.textContent = `${Math.round(v * 100)}%`;
      capGrid.append(label, bar, pct);
    }
    medicalBody.appendChild(capGrid);

    medicalBody.appendChild(medicalSectionHeader('Body'));
    const bodyList = document.createElement('div');
    Object.assign(bodyList.style, { fontSize: '11px', marginBottom: '8px' });
    renderBodyParts(bodyList, health.injuries);
    medicalBody.appendChild(bodyList);

    medicalBody.appendChild(medicalSectionHeader(`Injuries (${health.injuries.length})`));
    if (health.injuries.length === 0) {
      medicalBody.appendChild(medicalEmptyLine('no active injuries'));
    } else {
      const injuryList = document.createElement('div');
      Object.assign(injuryList.style, { fontSize: '11px' });
      for (const inj of health.injuries) injuryList.appendChild(injuryRow(inj));
      medicalBody.appendChild(injuryList);
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

/** @param {string} msg */
function medicalEmptyLine(msg) {
  const d = document.createElement('div');
  Object.assign(d.style, { fontSize: '11px', color: '#7a8590', fontStyle: 'italic' });
  d.textContent = msg;
  return d;
}

/** @param {string} label */
function medicalSectionHeader(label) {
  const d = document.createElement('div');
  Object.assign(d.style, {
    fontSize: '10px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#8fa0af',
    fontWeight: '700',
    marginBottom: '3px',
  });
  d.textContent = label;
  return d;
}

/** @param {import('../world/anatomy.js').Capacity} cap */
function capacityLabel(cap) {
  if (cap === 'BloodPumping') return 'Blood Pumping';
  if (cap === 'BloodFiltration') return 'Blood Filtration';
  return cap;
}

/**
 * Skill-level → color. Mirrors capacityTone's band palette but keyed off raw
 * level so "low skill" reads warm-red and "mastered" reads bright green.
 *
 * @param {number} level 0..MAX_LEVEL
 */
function skillTone(level) {
  if (level >= 18) return '#7ad07a';
  if (level >= 12) return '#b8d07a';
  if (level >= 7) return '#d0c97a';
  if (level >= 3) return '#d0a97a';
  return '#7a8590';
}

/** @param {number} ratio 0..1 */
function capacityTone(ratio) {
  if (ratio >= 0.95) return '#7ad07a';
  if (ratio >= 0.75) return '#b8d07a';
  if (ratio >= 0.5) return '#d0c97a';
  if (ratio >= 0.25) return '#d0a97a';
  return '#d07a7a';
}

/**
 * Walks HUMAN_ANATOMY in order and renders only top-level parts with their
 * children indented below. Container parts (maxHp=0) render their own row
 * with the aggregate HP of their children. Fully healthy parts are dimmed
 * so the eye jumps to the damaged ones.
 *
 * @param {HTMLElement} host
 * @param {import('../world/anatomy.js').Injury[]} injuries
 */
function renderBodyParts(host, injuries) {
  for (const part of HUMAN_ANATOMY) {
    if (part.parentId !== null) continue;
    host.appendChild(bodyPartRow(part, injuries, 0));
    for (const child of HUMAN_ANATOMY) {
      if (child.parentId !== part.id) continue;
      host.appendChild(bodyPartRow(child, injuries, 1));
    }
  }
}

/**
 * @param {import('../world/anatomy.js').BodyPart} part
 * @param {import('../world/anatomy.js').Injury[]} injuries
 * @param {number} depth
 */
function bodyPartRow(part, injuries, depth) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1px 0',
    paddingLeft: `${depth * 10}px`,
  });
  const label = document.createElement('span');
  label.textContent = part.label;
  const isContainer = part.maxHp <= 0;
  const ratio = isContainer ? 1 : partHpRatio(part.id, injuries);
  const dim = ratio >= 0.999;
  Object.assign(label.style, {
    color: dim ? '#7a8590' : '#e6e6e6',
    fontWeight: isContainer ? '600' : '400',
  });
  const hp = document.createElement('span');
  if (isContainer) {
    hp.textContent = '';
  } else if (ratio <= 0) {
    hp.textContent = 'destroyed';
    hp.style.color = '#d07a7a';
  } else {
    hp.textContent = `${Math.round(partHp(part.id, injuries))} / ${part.maxHp}`;
    hp.style.color = dim ? '#7a8590' : capacityTone(ratio);
  }
  Object.assign(hp.style, { fontVariantNumeric: 'tabular-nums' });
  row.append(label, hp);
  return row;
}

/** @param {import('../world/anatomy.js').Injury} inj */
function injuryRow(inj) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '6px',
    padding: '2px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
  });
  const left = document.createElement('span');
  const partLabel = bodyPartLabel(inj.partId);
  left.textContent = `${inj.type} · ${partLabel}${inj.permanent ? ' (scar)' : ''}`;
  const right = document.createElement('span');
  Object.assign(right.style, { fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' });
  const parts = [];
  if (inj.severity > 0) parts.push(`${inj.severity.toFixed(0)} HP`);
  if (inj.bleedRate > 0 && !inj.tended) parts.push('bleeding');
  if (inj.infection > 0) parts.push(`infection ${Math.round(inj.infection * 100)}%`);
  if (inj.tended) parts.push('tended');
  right.textContent = parts.join(' · ');
  right.style.color = inj.infection > 0 ? '#d07a7a' : inj.tended ? '#7ad07a' : '#d0a97a';
  row.append(left, right);
  return row;
}

/** @param {string} partId */
function bodyPartLabel(partId) {
  for (const p of HUMAN_ANATOMY) {
    if (p.id === partId) return p.label;
  }
  return partId;
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

/**
 * Crude a/an picker: vowel-sound check on the first letter is wrong on
 * "Honest" or "University" but our profession strings start with plain words
 * so the naive rule reads right ~all of the time.
 *
 * @param {string} word
 */
function articleFor(word) {
  const first = word.trim().charAt(0).toLowerCase();
  return 'aeiou'.includes(first) ? 'an' : 'a';
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
 * @param {HTMLElement} line
 * @param {string} label
 * @param {string} text
 */
function fillBackstoryLine(line, label, text) {
  line.replaceChildren();
  if (!text) return;
  const tag = document.createElement('span');
  Object.assign(tag.style, { color: '#8fa0af', fontWeight: '600' });
  tag.textContent = label;
  const body = document.createElement('span');
  Object.assign(body.style, { fontStyle: 'italic' });
  body.textContent = text;
  line.append(tag, body);
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
 * Small horizontal progress bar with a label + value text. Returns the root
 * node and an `update(value, text?)` closure so callers can poke it without
 * having to touch the DOM directly.
 *
 * @param {string} label
 * @param {string} color
 */
function createNeedBar(label, color) {
  const root = document.createElement('div');
  Object.assign(root.style, { display: 'flex', alignItems: 'center', gap: '6px' });
  const labelEl = document.createElement('div');
  Object.assign(labelEl.style, {
    width: '60px',
    color: '#9ba6b1',
    flex: '0 0 60px',
  });
  labelEl.textContent = label;
  const track = document.createElement('div');
  Object.assign(track.style, {
    position: 'relative',
    flex: '1 1 auto',
    height: '10px',
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '3px',
    overflow: 'hidden',
  });
  const fill = document.createElement('div');
  Object.assign(fill.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    bottom: '0',
    width: '0%',
    background: color,
    transition: 'width 120ms linear',
  });
  const text = document.createElement('div');
  Object.assign(text.style, {
    width: '32px',
    textAlign: 'right',
    color: '#d8dfe6',
    flex: '0 0 32px',
  });
  track.appendChild(fill);
  root.append(labelEl, track, text);
  /**
   * @param {number} value 0..1
   * @param {string=} overrideText
   */
  function update(value, overrideText) {
    const pct = Math.max(0, Math.min(1, value)) * 100;
    fill.style.width = `${pct.toFixed(1)}%`;
    text.textContent = overrideText ?? `${pct.toFixed(0)}%`;
  }
  return { root, update };
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
