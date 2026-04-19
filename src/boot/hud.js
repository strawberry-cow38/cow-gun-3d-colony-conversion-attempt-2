/**
 * Debug HUD: the top-left readout you see on the canvas plus the little
 * helpers (debug-flag visibility, stale-selection pruning, item counting)
 * that only the HUD cares about. `createHud` returns an API object so the
 * designator callbacks and the keyboard handler can all poke the same HUD.
 */

import { defaultWalkable } from '../sim/pathfinding.js';
import { COW_SPEED_UNITS_PER_SEC } from '../systems/cow.js';
import { DARKNESS_SLOWDOWN_THRESHOLD } from '../systems/lighting.js';
import { objectTypeFor } from '../ui/objectTypes.js';
import { UNITS_PER_METER, worldToTileClamp } from '../world/coords.js';
import { ITEM_KINDS } from '../world/items.js';
import { BIOME } from '../world/tileGrid.js';
import { countDrafted } from './drafting.js';
import { countComp } from './utils.js';

const DARK_LIGHT_BYTE = Math.round(DARKNESS_SLOWDOWN_THRESHOLD * 255);

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
 * @property {{ setDebugVisible(v: boolean): void }} cowHitboxes
 * @property {{ setVisible(v: boolean): void }} cowThoughtBubbles
 * @property {{ setVisible(v: boolean): void }} roomOverlay
 * @property {{ setVisible(v: boolean): void }} ignoreRoofOverlay
 * @property {{ setVisible(v: boolean): void }} roofInstancer
 * @property {{ setVisible(v: boolean): void }} pickTileOverlay
 * @property {import('../systems/rooms.js').RoomRegistry} rooms
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
    ctx.cowHitboxes.setDebugVisible(state.debugEnabled);
    ctx.cowThoughtBubbles.setVisible(state.debugEnabled);
    ctx.roomOverlay.setVisible(state.debugEnabled);
    ctx.ignoreRoofOverlay.setVisible(state.debugEnabled);
    ctx.pickTileOverlay.setVisible(state.debugEnabled);
    // Roofs have their own visibility toggle (V key) that's independent of
    // the debug menu — players need to peek into rooms mid-play.
    ctx.roofInstancer.setVisible(state.roofsVisible !== false);
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
    for (const id of state.selectedItems) {
      if (!world.get(id, 'Item')) state.selectedItems.delete(id);
    }
    for (const id of state.selectedFurnaces) {
      if (!world.get(id, 'Furnace')) state.selectedFurnaces.delete(id);
    }
    if (state.primaryFurnace !== null && !state.selectedFurnaces.has(state.primaryFurnace)) {
      state.primaryFurnace =
        state.selectedFurnaces.size > 0
          ? /** @type {number} */ (state.selectedFurnaces.values().next().value)
          : null;
    }
    for (const id of state.selectedEasels) {
      if (!world.get(id, 'Easel')) state.selectedEasels.delete(id);
    }
    if (state.primaryEasel !== null && !state.selectedEasels.has(state.primaryEasel)) {
      state.primaryEasel =
        state.selectedEasels.size > 0
          ? /** @type {number} */ (state.selectedEasels.values().next().value)
          : null;
    }
    for (const id of state.selectedStoves) {
      if (!world.get(id, 'Stove')) state.selectedStoves.delete(id);
    }
    if (state.primaryStove !== null && !state.selectedStoves.has(state.primaryStove)) {
      state.primaryStove =
        state.selectedStoves.size > 0
          ? /** @type {number} */ (state.selectedStoves.values().next().value)
          : null;
    }
    for (const id of state.selectedBeds) {
      if (!world.get(id, 'Bed')) state.selectedBeds.delete(id);
    }
    if (state.primaryBed !== null && !state.selectedBeds.has(state.primaryBed)) {
      state.primaryBed =
        state.selectedBeds.size > 0
          ? /** @type {number} */ (state.selectedBeds.values().next().value)
          : null;
    }
    for (const id of state.selectedStairs) {
      if (!world.get(id, 'Stair')) state.selectedStairs.delete(id);
    }
    if (state.primaryStair !== null && !state.selectedStairs.has(state.primaryStair)) {
      state.primaryStair =
        state.selectedStairs.size > 0
          ? /** @type {number} */ (state.selectedStairs.values().next().value)
          : null;
    }
    for (const id of state.selectedObjects) {
      if (!objectTypeFor(world, id)) state.selectedObjects.delete(id);
    }
    if (state.primaryObject !== null && !state.selectedObjects.has(state.primaryObject)) {
      state.primaryObject =
        state.selectedObjects.size > 0
          ? /** @type {number} */ (state.selectedObjects.values().next().value)
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
      const tiredness = world.get(state.primaryCow, 'Tiredness');
      const job = world.get(state.primaryCow, 'Job');
      const path = world.get(state.primaryCow, 'Path');
      const pos = world.get(state.primaryCow, 'Position');
      const vel = world.get(state.primaryCow, 'Velocity');
      if (brain) {
        const header =
          selCount === 1
            ? `selected: ${brain.name}`
            : `selected: ${selCount} cows (primary: ${brain.name})`;
        const speedUps = vel ? Math.hypot(vel.x, vel.z) : 0;
        const baseMps = COW_SPEED_UNITS_PER_SEC / UNITS_PER_METER;
        const curMps = speedUps / UNITS_PER_METER;
        const tile = worldToTileClamp(pos.x, pos.z, tileGrid.W, tileGrid.H);
        const dim =
          tileGrid.inBounds(tile.i, tile.j) && tileGrid.getLight(tile.i, tile.j) < DARK_LIGHT_BYTE;
        const walkLine = `  walk: ${curMps.toFixed(2)}m/s (base ${baseMps.toFixed(2)}m/s)${dim ? ' [dim tile: 50%]' : ''}`;
        cowLines = [
          '',
          header,
          `  pos: x=${pos.x.toFixed(1)} z=${pos.z.toFixed(1)}`,
          `  hunger: ${(hunger.value * 100).toFixed(0)}%`,
          `  tiredness: ${(tiredness.value * 100).toFixed(0)}%`,
          `  job: ${job.kind} / ${job.state}`,
          `  path: ${path.index}/${path.steps.length} steps`,
          walkLine,
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
      const lightPct = Math.round(
        (tileGrid.getLight(state.lastPick.i, state.lastPick.j) / 255) * 100,
      );
      pickStr = `pick: i=${state.lastPick.i} j=${state.lastPick.j}  elev=${elev.toFixed(1)}  biome=${biomeName}  walkable=${walk}  light=${lightPct}%`;
    }
    const sunPct = Math.round(ctx.timeOfDay.getSunLightPercent() * 100);
    const roofsHidden = state.roofsVisible === false;
    const lines = [
      `grid: ${gridW}x${gridH}  tiles=${gridW * gridH}`,
      `sim: tick=${loop.tick}  Hz=${loop.measuredHz.toFixed(0)}/${30 * loop.speed}  speed=${loop.speed}x  steps/frame=${loop.lastSteps}`,
      `render: ${ctx.getFps().toFixed(0)} fps`,
      `entities: ${world.entityCount}  cows=${countComp(world, 'Cow')}  trees=${countComp(world, 'Tree')}  ${itemCountsStr()}`,
      `paths: hits=${pathCache.hits} misses=${pathCache.misses}  jobs=${jobBoard.openCount}`,
      `time: ${ctx.timeOfDay.getHHMM()}  weather: ${ctx.weather.getCurrent()}  sun-light: ${sunPct}%`,
      `rooms: ${ctx.rooms.rooms.size}  roofs: ${roofsHidden ? 'hidden' : 'shown'}`,
      pickStr,
      ...cowLines,
      '',
    ];
    if (ctx.chopDesignator.active) {
      lines.push('** CHOP DESIGNATE — LMB drag = mark, Shift+drag = unmark, Esc to exit **');
    }
    if (ctx.stockpileDesignator.active) {
      lines.push('** STOCKPILE DESIGNATE — LMB drag = add, Shift+drag = remove, Esc to exit **');
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
    lines.push(`drafted: ${draftedCount}`);
    hud.innerText = lines.join('\n');
  }

  return { updateHud, applyDebugVisibility, pruneStaleSelections };
}
