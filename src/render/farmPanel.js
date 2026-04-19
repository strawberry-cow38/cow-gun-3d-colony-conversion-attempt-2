/**
 * Selected-farm-zone panel. Crop radio picker (corn/carrot/potato) drives the
 * zone's cropKind, plus an info block summarising the crops currently
 * growing: tile count, planted timestamp of oldest crop, harvest ETA, and a
 * per-stage bar. Delete button removes the zone.
 *
 * Mirrors stockpilePanel: shown only when `state.selectedFarmZoneId` is
 * non-null, rebuilds only when its dirty key flips so click events on the
 * radios don't get wiped between mousedown and mouseup.
 */

import { SIM_MS_PER_TICK, formatSimDate, formatSimTime, tickToSimDate } from '../sim/calendar.js';
import {
  CROP_GROWTH_TICKS,
  CROP_KINDS,
  CROP_STAGES,
  CROP_VISUALS,
  cropStageFor,
} from '../world/crops.js';

/**
 * @typedef {Object} FarmPanelOpts
 * @property {import('../boot/input.js').BootState} state
 * @property {import('../systems/farmZones.js').FarmZones} farmZones
 * @property {import('../ecs/world.js').World} world
 * @property {import('../world/tileGrid.js').TileGrid} tileGrid
 * @property {() => number} getTick
 * @property {(id: number) => void} onDelete
 * @property {() => void} onChange
 */

/** @param {FarmPanelOpts} opts */
export function createFarmPanel(opts) {
  const { state, farmZones, world, tileGrid, getTick, onDelete, onChange } = opts;

  const root = document.createElement('div');
  root.id = 'farm-panel';
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
  title.textContent = 'Farm Zone';

  const subtitle = document.createElement('div');
  Object.assign(subtitle.style, { fontSize: '11px', color: '#b5c0cc', marginBottom: '8px' });

  const cropLabel = document.createElement('div');
  Object.assign(cropLabel.style, {
    fontSize: '11px',
    color: '#b5c0cc',
    marginBottom: '4px',
  });
  cropLabel.textContent = 'Crop';

  const cropWrap = document.createElement('div');
  Object.assign(cropWrap.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginBottom: '8px',
  });

  const infoWrap = document.createElement('div');
  Object.assign(infoWrap.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '6px 8px',
    background: 'rgba(30, 36, 44, 0.8)',
    borderRadius: '2px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    fontSize: '11px',
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
    if (state.selectedFarmZoneId != null) onDelete(state.selectedFarmZoneId);
  });

  root.append(title, subtitle, cropLabel, cropWrap, infoWrap, deleteBtn);
  document.body.appendChild(root);

  let lastKey = '';

  function update() {
    const id = state.selectedFarmZoneId;
    if (id == null) {
      if (root.style.display !== 'none') root.style.display = 'none';
      lastKey = '';
      return;
    }
    const zone = farmZones.zoneById(id);
    if (!zone) {
      if (root.style.display !== 'none') root.style.display = 'none';
      lastKey = '';
      return;
    }
    const tick = getTick();
    // Coarse key — tick bucket changes once per sim second, catching plant /
    // harvest / stage advances within ≤1s. Built before the expensive world
    // query so the hot path is a single string compare when nothing changed.
    const key = `${id}|${zone.tiles.size}|${zone.cropKind}|${Math.floor(tick / 30)}`;
    if (key === lastKey) {
      if (root.style.display === 'none') root.style.display = '';
      return;
    }
    lastKey = key;
    const crops = collectZoneCrops(world, tileGrid, zone);
    const { oldestPlantedAtTick, earliestHarvestTick, stageCounts } = summariseCrops(crops);
    if (root.style.display === 'none') root.style.display = '';
    subtitle.textContent = `${zone.tiles.size} tile${zone.tiles.size === 1 ? '' : 's'} · ${crops.length} planted`;
    rebuildCropPicker(zone.id, zone.cropKind);
    rebuildInfo({
      zone,
      crops,
      oldestPlantedAtTick,
      earliestHarvestTick,
      stageCounts,
      tick,
    });
  }

  /** @param {number} zoneId @param {string} currentCrop */
  function rebuildCropPicker(zoneId, currentCrop) {
    cropWrap.replaceChildren();
    for (const kind of CROP_KINDS) {
      cropWrap.append(buildCropRow(zoneId, kind, kind === currentCrop));
    }
  }

  /** @param {number} zoneId @param {string} kind @param {boolean} on */
  function buildCropRow(zoneId, kind, on) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 4px',
      cursor: 'pointer',
      borderRadius: '2px',
      background: on ? 'rgba(68, 221, 136, 0.18)' : 'transparent',
    });
    const box = document.createElement('span');
    box.textContent = on ? '●' : '○';
    Object.assign(box.style, {
      width: '14px',
      textAlign: 'center',
      color: on ? '#8fbcdb' : '#6b7785',
    });
    const viz = /** @type {any} */ (CROP_VISUALS)[kind];
    const icon = document.createElement('span');
    icon.textContent = viz?.icon ?? '';
    Object.assign(icon.style, { width: '14px', textAlign: 'center' });
    const name = document.createElement('span');
    name.textContent = viz?.label ?? kind;
    row.append(box, icon, name);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (on) return;
      farmZones.setCrop(zoneId, kind);
      onChange();
      update();
    });
    return row;
  }

  /**
   * @param {{
   *   zone: { id: number, tiles: Set<number>, cropKind: string },
   *   crops: { growthTicks: number, plantedAtTick: number, kind: string }[],
   *   oldestPlantedAtTick: number | null,
   *   earliestHarvestTick: number | null,
   *   stageCounts: number[],
   *   tick: number,
   * }} data
   */
  function rebuildInfo({
    zone,
    crops,
    oldestPlantedAtTick,
    earliestHarvestTick,
    stageCounts,
    tick,
  }) {
    infoWrap.replaceChildren();
    const total = CROP_GROWTH_TICKS[zone.cropKind] ?? 0;
    const growthRealSeconds = total > 0 ? (total * SIM_MS_PER_TICK) / 1000 : 0;
    infoWrap.append(
      infoRow(
        'Growth time',
        growthRealSeconds > 0 ? `${formatDuration(growthRealSeconds)} (full sun)` : '—',
      ),
    );
    if (oldestPlantedAtTick != null) {
      const d = tickToSimDate(oldestPlantedAtTick);
      infoWrap.append(infoRow('First planted', `${formatSimTime(d)} ${formatSimDate(d)}`));
    } else {
      infoWrap.append(infoRow('First planted', '—'));
    }
    if (earliestHarvestTick != null && earliestHarvestTick > tick) {
      const remainingTicks = earliestHarvestTick - tick;
      const remainingSec = (remainingTicks * SIM_MS_PER_TICK) / 1000;
      infoWrap.append(infoRow('Next harvest', `~${formatDuration(remainingSec)} (sunlight)`));
    } else if (earliestHarvestTick != null) {
      infoWrap.append(infoRow('Next harvest', 'ready'));
    } else {
      infoWrap.append(infoRow('Next harvest', '—'));
    }
    infoWrap.append(buildStageBar(stageCounts, crops.length));
  }

  /** @param {string} label @param {string} value */
  function infoRow(label, value) {
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', gap: '6px' });
    const l = document.createElement('span');
    l.textContent = label;
    Object.assign(l.style, { color: '#b5c0cc' });
    const v = document.createElement('span');
    v.textContent = value;
    Object.assign(v.style, { color: '#e6e6e6' });
    row.append(l, v);
    return row;
  }

  /** @param {number[]} stageCounts @param {number} total */
  function buildStageBar(stageCounts, total) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { marginTop: '4px' });
    const label = document.createElement('div');
    label.textContent = 'Growth stages';
    Object.assign(label.style, { color: '#b5c0cc', marginBottom: '2px' });
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      display: 'flex',
      width: '100%',
      height: '10px',
      borderRadius: '2px',
      overflow: 'hidden',
      background: 'rgba(0, 0, 0, 0.35)',
    });
    const legend = document.createElement('div');
    Object.assign(legend.style, {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: '2px',
      fontSize: '10px',
      color: '#b5c0cc',
    });
    const colors = ['#4a6a3a', '#6a9044', '#9dbd4a', '#d9c24a'];
    for (let s = 0; s < CROP_STAGES; s++) {
      const cell = document.createElement('div');
      const pct = total > 0 ? (stageCounts[s] / total) * 100 : 0;
      Object.assign(cell.style, {
        width: `${pct}%`,
        background: colors[s] ?? '#888',
      });
      bar.append(cell);
      const lbl = document.createElement('span');
      lbl.textContent = `${s + 1}:${stageCounts[s]}`;
      legend.append(lbl);
    }
    wrap.append(label, bar, legend);
    return wrap;
  }

  return { update, root };
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {import('../world/tileGrid.js').TileGrid} grid
 * @param {{ tiles: Set<number> }} zone
 */
function collectZoneCrops(world, grid, zone) {
  /** @type {{ growthTicks: number, plantedAtTick: number, kind: string }[]} */
  const out = [];
  for (const { components } of world.query(['Crop', 'TileAnchor'])) {
    const a = components.TileAnchor;
    if (!zone.tiles.has(grid.idx(a.i, a.j))) continue;
    out.push({
      growthTicks: components.Crop.growthTicks,
      plantedAtTick: components.Crop.plantedAtTick ?? 0,
      kind: components.Crop.kind,
    });
  }
  return out;
}

/**
 * @param {{ growthTicks: number, plantedAtTick: number, kind: string }[]} crops
 */
function summariseCrops(crops) {
  /** @type {number[]} */
  const stageCounts = new Array(CROP_STAGES).fill(0);
  let oldestPlantedAtTick = /** @type {number | null} */ (null);
  let earliestHarvestTick = /** @type {number | null} */ (null);
  for (const c of crops) {
    const stage = cropStageFor(c.kind, c.growthTicks);
    stageCounts[stage]++;
    if (oldestPlantedAtTick == null || c.plantedAtTick < oldestPlantedAtTick) {
      oldestPlantedAtTick = c.plantedAtTick;
    }
    // Best-case ETA: assume full sun from now until ready. Real harvest can
    // slip if the tile spends time shaded — this gives the player an
    // optimistic floor that shrinks as growth accumulates.
    const total = CROP_GROWTH_TICKS[c.kind] ?? 0;
    const approxHarvestTick = c.plantedAtTick + total;
    if (earliestHarvestTick == null || approxHarvestTick < earliestHarvestTick) {
      earliestHarvestTick = approxHarvestTick;
    }
  }
  return { oldestPlantedAtTick, earliestHarvestTick, stageCounts };
}

/** @param {number} seconds */
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m - h * 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}
