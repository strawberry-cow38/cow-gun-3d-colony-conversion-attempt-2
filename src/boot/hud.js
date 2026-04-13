/**
 * Debug HUD: the top-left readout you see on the canvas plus the little
 * helpers (debug-flag visibility, stale-selection pruning, item counting)
 * that only the HUD cares about. `createHud` returns an API object so the
 * designator callbacks and the keyboard handler can all poke the same HUD.
 */

import { defaultWalkable } from '../sim/pathfinding.js';
import { ITEM_KINDS } from '../world/items.js';
import { BIOME } from '../world/tileGrid.js';
import { countDrafted } from './drafting.js';
import { countComp } from './utils.js';

const BIOME_NAMES = /** @type {Record<number, string>} */ ({
  [BIOME.GRASS]: 'grass',
  [BIOME.DIRT]: 'dirt',
  [BIOME.STONE]: 'stone',
  [BIOME.SAND]: 'sand',
});

/**
 * @typedef {Object} HudCtx
 * @property {HTMLElement} hud
 * @property {import('../ecs/world.js').World} world
 * @property {import('../world/tileGrid.js').TileGrid} tileGrid
 * @property {import('../sim/pathfinding.js').PathCache} pathCache
 * @property {import('../jobs/board.js').JobBoard} jobBoard
 * @property {number} gridW
 * @property {number} gridH
 * @property {import('../sim/loop.js').SimLoop} loop
 * @property {import('./input.js').BootState} state
 * @property {any} fpCamera
 * @property {{ active: boolean }} chopDesignator
 * @property {{ active: boolean }} stockpileDesignator
 * @property {{ setVisible(v: boolean): void }} cowNameTags
 * @property {{ setVisible(v: boolean): void }} cowThoughtBubbles
 * @property {{ setVisible(v: boolean): void }} itemLabels
 * @property {{ setVisible(v: boolean): void }} stockpileOverlay
 * @property {{ setVisible(v: boolean): void }} pickTileOverlay
 * @property {import('../world/timeOfDay.js').TimeOfDay} timeOfDay
 * @property {import('../world/weather.js').Weather} weather
 * @property {() => number} getFps
 *
 * @typedef {Object} HudApi
 * @property {() => void} updateHud
 * @property {() => void} applyDebugVisibility
 * @property {() => void} pruneStaleSelections
 */

/** @param {HudCtx} ctx @returns {HudApi} */
export function createHud(ctx) {
  const { hud, world, tileGrid, pathCache, jobBoard, gridW, gridH, loop, state } = ctx;

  /**
   * Mirror the debug flag out to the world-space overlays. Kept as one place
   * so a future overlay just needs to add a line here instead of chasing the
   * flag through the keydown handler.
   */
  function applyDebugVisibility() {
    ctx.cowNameTags.setVisible(state.debugEnabled);
    ctx.cowThoughtBubbles.setVisible(state.debugEnabled);
    ctx.itemLabels.setVisible(state.debugEnabled);
    ctx.stockpileOverlay.setVisible(state.debugEnabled);
    ctx.pickTileOverlay.setVisible(state.debugEnabled);
  }

  function itemCountsStr() {
    const totals = /** @type {Record<string, number>} */ ({});
    for (const k of ITEM_KINDS) totals[k] = 0;
    for (const { components } of world.query(['Item'])) {
      const k = components.Item.kind;
      totals[k] = (totals[k] ?? 0) + components.Item.count;
    }
    return ITEM_KINDS.map((k) => `${k}=${totals[k]}`).join(' ');
  }

  function pruneStaleSelections() {
    for (const id of state.selectedCows) {
      if (!world.get(id, 'Position')) state.selectedCows.delete(id);
    }
    if (state.primaryCow !== null && !state.selectedCows.has(state.primaryCow)) {
      state.primaryCow =
        state.selectedCows.size > 0
          ? /** @type {number} */ (state.selectedCows.values().next().value)
          : null;
    }
  }

  function updateHud() {
    if (!state.debugEnabled) {
      hud.style.display = 'none';
      return;
    }
    hud.style.display = '';
    let cowLines = ['', 'click a cow to inspect'];
    const selCount = state.selectedCows.size;
    if (selCount > 0 && state.primaryCow !== null) {
      const brain = world.get(state.primaryCow, 'Brain');
      const hunger = world.get(state.primaryCow, 'Hunger');
      const job = world.get(state.primaryCow, 'Job');
      const path = world.get(state.primaryCow, 'Path');
      const pos = world.get(state.primaryCow, 'Position');
      if (brain) {
        const header =
          selCount === 1
            ? `selected: ${brain.name}`
            : `selected: ${selCount} cows (primary: ${brain.name})`;
        cowLines = [
          '',
          header,
          `  pos: x=${pos.x.toFixed(1)} z=${pos.z.toFixed(1)}`,
          `  hunger: ${(hunger.value * 100).toFixed(0)}%`,
          `  job: ${job.kind} / ${job.state}`,
          `  path: ${path.index}/${path.steps.length} steps`,
        ];
      } else {
        cowLines = ['', 'selected cow despawned'];
        state.selectedCows.delete(state.primaryCow);
        state.primaryCow =
          state.selectedCows.size > 0
            ? /** @type {number} */ (state.selectedCows.values().next().value)
            : null;
      }
    }
    let pickStr = 'pick: (click a tile)';
    if (state.lastPick && tileGrid.inBounds(state.lastPick.i, state.lastPick.j)) {
      const elev = tileGrid.getElevation(state.lastPick.i, state.lastPick.j);
      const biomeId = tileGrid.getBiome(state.lastPick.i, state.lastPick.j);
      const biomeName = BIOME_NAMES[biomeId] ?? `biome#${biomeId}`;
      const walk = defaultWalkable(tileGrid, state.lastPick.i, state.lastPick.j) ? 'yes' : 'no';
      pickStr = `pick: i=${state.lastPick.i} j=${state.lastPick.j}  elev=${elev.toFixed(1)}  biome=${biomeName}  walkable=${walk}`;
    }
    const lines = [
      'phase 4: trees + chop + stacks + eat',
      `grid: ${gridW}x${gridH}  tiles=${gridW * gridH}`,
      `sim: tick=${loop.tick}  Hz=${loop.measuredHz.toFixed(0)}/${30 * loop.speed}  speed=${loop.speed}x  steps/frame=${loop.lastSteps}`,
      `render: ${ctx.getFps().toFixed(0)} fps`,
      `entities: ${world.entityCount}  cows=${countComp(world, 'Cow')}  trees=${countComp(world, 'Tree')}  ${itemCountsStr()}`,
      `paths: hits=${pathCache.hits} misses=${pathCache.misses}  jobs=${jobBoard.openCount}`,
      `time: ${ctx.timeOfDay.getHHMM()}  weather: ${ctx.weather.getCurrent()}`,
      pickStr,
      ...cowLines,
      '',
    ];
    if (ctx.chopDesignator.active) {
      lines.push('** CHOP DESIGNATE — LMB drag = mark, Shift+drag = unmark, C or Esc to exit **');
    }
    if (ctx.stockpileDesignator.active) {
      lines.push(
        '** STOCKPILE DESIGNATE — LMB drag = add, Shift+drag = remove, B or Esc to exit **',
      );
    }
    if (ctx.fpCamera.active) {
      const viewed = ctx.fpCamera.cowId;
      const viewedCow = viewed !== null ? world.get(viewed, 'Cow') : null;
      const drafted = viewedCow?.drafted === true;
      const mode = drafted ? 'DRAFTED (WASD + mouse)' : 'SPECTATE';
      lines.push(
        `** FIRST-PERSON ${mode} — cow #${viewed} — Q/E cycle, R ${drafted ? 'release' : 'draft'}, H exit **`,
      );
    } else if (state.followEnabled && state.primaryCow !== null) {
      lines.push(
        `** FOLLOWING cow #${state.primaryCow} — click a cow to switch, Q/E cycle, F or WASD release **`,
      );
    } else if (state.followEnabled) {
      lines.push('** FOLLOW MODE — click a cow to lock onto them (F to disable) **');
    }
    const draftedCount = countDrafted(world);
    lines.push(
      `drafted: ${draftedCount}`,
      'WASD/arrows = pan (hold Shift = 2x), MMB-drag = orbit, wheel = zoom',
      'LMB = select, Shift+LMB = add/toggle, RMB = move-to, Shift+RMB = queue',
      'C = chop designate,  B = stockpile designate,  V = wall designate,  M = door designate',
      'F = toggle follow (tracks selected cow; Q/E cycle, WASD releases),  H = first-person',
      'R = draft/release selected cow(s)  (drafted cows stand still + take player orders)',
      'P = toggle debug menu  (also disables the debug-only keys below)',
      'N = spawn cow,  G = drop stone,  J = drop food  (at last clicked tile)',
      'K = save, L = load',
      'T = time +2h (Shift+T = -2h),  Y = cycle weather,  1/2/3/4 = sim speed (1/2/3/6x)',
    );
    hud.innerText = lines.join('\n');
  }

  return { updateHud, applyDebugVisibility, pruneStaleSelections };
}
