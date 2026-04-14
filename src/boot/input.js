/**
 * Global keyboard handler. The 30-or-so key bindings are independent —
 * grouping them here keeps main.js from drowning in a 200-line switch.
 *
 * Each handler receives a single `ctx` with the mutable state bag
 * (`ctx.state`) plus the world/scene/renderer handles it needs. Main.js owns
 * `state` so HUD + render + pickers read the same values the keys mutate.
 */

import { buildTileMesh } from '../render/tileMesh.js';
import { spawnInitialTrees } from '../systems/trees.js';
import { addItemToTile } from '../world/items.js';
import { CURRENT_VERSION } from '../world/migrations/index.js';
import {
  gunzipBytes,
  gzipString,
  hydrateBuildSites,
  hydrateCows,
  hydrateDoors,
  hydrateItems,
  hydrateRoofs,
  hydrateTileGrid,
  hydrateTorches,
  hydrateTrees,
  hydrateWalls,
  loadState,
  serializeState,
} from '../world/persist.js';
import { toggleDraft } from './drafting.js';
import { spawnCowAt } from './spawn.js';
import { allCowIds, base64ToBytes, bytesToBase64, despawnAllComp } from './utils.js';

const SPEED_KEYS = /** @type {Record<string, number>} */ ({
  Digit1: 1,
  Digit2: 2,
  Digit3: 3,
  Digit4: 6,
});

const PAN_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * @typedef {Object} BootState
 * @property {boolean} debugEnabled
 * @property {boolean} followEnabled
 * @property {number|null} primaryCow
 * @property {Set<number>} selectedCows
 * @property {{ i: number, j: number } | null} lastPick
 * @property {import('three').Mesh} tileMesh
 * @property {number} [pausedSpeed]  last non-zero speed, restored when space unpauses
 * @property {boolean} [roofsVisible] defaults true; V toggles
 *
 * @typedef {Object} InputCtx
 * @property {import('../ecs/world.js').World} world
 * @property {import('../world/tileGrid.js').TileGrid} tileGrid
 * @property {import('../sim/pathfinding.js').PathCache} pathCache
 * @property {import('../jobs/board.js').JobBoard} jobBoard
 * @property {import('three').Scene} scene
 * @property {any} fpCamera
 * @property {any} rts
 * @property {any} itemInstancer
 * @property {any} treeInstancer
 * @property {any} stockpileOverlay
 * @property {{ markDirty: () => void } | null} [buildSiteInstancer]
 * @property {{ markDirty: () => void } | null} [wallInstancer]
 * @property {import('../systems/rooms.js').RoomRegistry} rooms
 * @property {{ markDirty: () => void }} roomOverlay
 * @property {{ markDirty: () => void }} ignoreRoofOverlay
 * @property {{ markDirty: () => void }} roofInstancer
 * @property {number} treeCount
 * @property {number} gridW
 * @property {number} gridH
 * @property {BootState} state
 * @property {{ play: (kind: string) => void }} audio
 * @property {import('../world/timeOfDay.js').TimeOfDay} timeOfDay
 * @property {import('../world/weather.js').Weather} weather
 * @property {import('../sim/loop.js').SimLoop} loop
 * @property {() => void} applyDebugVisibility
 * @property {() => void} updateHud
 */

/** @param {InputCtx} ctx */
export function installKeyboard(ctx) {
  addEventListener('keydown', (e) => {
    void handleKey(ctx, e);
  });
}

/** @param {InputCtx} ctx @param {KeyboardEvent} e */
async function handleKey(ctx, e) {
  const { state, fpCamera, rts, world } = ctx;

  if (e.code === 'KeyP') {
    state.debugEnabled = !state.debugEnabled;
    ctx.audio.play(state.debugEnabled ? 'toggle_on' : 'toggle_off');
    ctx.applyDebugVisibility();
    ctx.updateHud();
    return;
  }
  if (e.code === 'KeyV') {
    state.roofsVisible = state.roofsVisible === false;
    ctx.audio.play(state.roofsVisible ? 'toggle_on' : 'toggle_off');
    ctx.applyDebugVisibility();
    ctx.updateHud();
    return;
  }
  // First-person: H toggles FP on/off, Q/E cycle the viewed cow.
  if (e.code === 'KeyH') {
    if (fpCamera.active) {
      // Recenter overhead on the cow we were just watching so exiting doesn't
      // dump us back at whatever corner of the map we entered FP from.
      if (fpCamera.cowId !== null) {
        const viewedPos = world.get(fpCamera.cowId, 'Position');
        if (viewedPos) rts.focus.set(viewedPos.x, viewedPos.y, viewedPos.z);
      }
      fpCamera.exit();
      ctx.audio.play('toggle_off');
    } else if (state.primaryCow !== null) {
      fpCamera.enter(state.primaryCow);
      // Drop the world selection — the viewed cow is tracked via fpCamera.cowId
      // while FP is active, and leaving them selected would re-target ghost
      // commands (move-to, draft) at a cow the player can't see highlighted.
      state.selectedCows.clear();
      state.primaryCow = null;
      ctx.audio.play('toggle_on');
    } else {
      ctx.audio.play('deny');
    }
    return;
  }
  if (fpCamera.active && (e.code === 'KeyQ' || e.code === 'KeyE')) {
    fpCamera.cycle(e.code === 'KeyE' ? 1 : -1);
    ctx.audio.play('cycle');
    return;
  }
  // F toggles follow mode. Follow tracks whoever is `primaryCow` every frame,
  // so plain-clicking a different cow automatically hands off the camera. If
  // nothing is selected when F is pressed, auto-select the first cow.
  if (e.code === 'KeyF') {
    if (state.followEnabled) {
      state.followEnabled = false;
      ctx.audio.play('toggle_off');
    } else {
      if (state.primaryCow === null) {
        const first = allCowIds(world)[0] ?? null;
        if (first !== null) {
          state.selectedCows.clear();
          state.selectedCows.add(first);
          state.primaryCow = first;
        }
      }
      state.followEnabled = state.primaryCow !== null;
      ctx.audio.play(state.followEnabled ? 'toggle_on' : 'deny');
    }
    ctx.updateHud();
    return;
  }
  // Q/E cycle primary while follow is engaged. Camera follows primary so
  // cycling primary auto-hands off the camera too.
  if (state.followEnabled && (e.code === 'KeyQ' || e.code === 'KeyE')) {
    const cows = allCowIds(world);
    if (cows.length > 0) {
      const curIdx = state.primaryCow !== null ? cows.indexOf(state.primaryCow) : -1;
      const dir = e.code === 'KeyE' ? 1 : -1;
      const nextIdx = (curIdx + dir + cows.length) % cows.length;
      const next = cows[nextIdx];
      state.selectedCows.clear();
      state.selectedCows.add(next);
      state.primaryCow = next;
      ctx.audio.play('cycle');
    }
    ctx.updateHud();
    return;
  }
  // Pan keys break follow — moving the camera manually implies "let me look
  // around" so the latch releases. Fall through so RtsCamera's own listener
  // still processes the pan on this same keydown.
  if (state.followEnabled && PAN_KEYS.has(e.code)) {
    state.followEnabled = false;
    ctx.updateHud();
  }
  // R toggles drafted. In FP, toggles the viewed cow. In overhead, toggles
  // every selected cow (to the majority state's opposite, so mixed selections
  // draft rather than thrash).
  if (e.code === 'KeyR') {
    const draftOpts = {
      grid: ctx.tileGrid,
      onItemChange: () => ctx.itemInstancer.markDirty(),
    };
    if (fpCamera.active && fpCamera.cowId !== null) {
      toggleDraft(world, [fpCamera.cowId], draftOpts);
      const cow = world.get(fpCamera.cowId, 'Cow');
      ctx.audio.play(cow?.drafted ? 'draft' : 'undraft');
      ctx.updateHud();
      return;
    }
    if (state.selectedCows.size > 0) {
      toggleDraft(world, [...state.selectedCows], draftOpts);
      // Post-toggle, primary's state reflects the new majority target.
      const primary = state.primaryCow !== null ? world.get(state.primaryCow, 'Cow') : null;
      ctx.audio.play(primary?.drafted ? 'draft' : 'undraft');
      ctx.updateHud();
    } else {
      ctx.audio.play('deny');
    }
    return;
  }

  // 1/2/3/4 set sim speed multiplier. Player-facing so it's NOT debug-gated.
  // 4 jumps to 6x (skipping 4x/5x) — the useful tier is "much faster" for
  // long hauls, so a single big-step key beats filling every integer slot.
  if (SPEED_KEYS[e.code] !== undefined) {
    ctx.loop.setSpeed(SPEED_KEYS[e.code]);
    ctx.audio.play('cycle');
    ctx.updateHud();
    return;
  }
  // Space toggles pause. Render keeps running so UI (build tab, portraits,
  // designators) stays interactive while the sim is frozen.
  if (e.code === 'Space') {
    e.preventDefault();
    if (ctx.loop.speed > 0) {
      state.pausedSpeed = ctx.loop.speed;
      ctx.loop.setSpeed(0);
      ctx.audio.play('toggle_off');
    } else {
      ctx.loop.setSpeed(state.pausedSpeed ?? 1);
      ctx.audio.play('toggle_on');
    }
    ctx.updateHud();
    return;
  }

  if (!state.debugEnabled) return;

  if (e.code === 'KeyN') {
    const tile = state.lastPick ?? { i: Math.floor(ctx.gridW / 2), j: Math.floor(ctx.gridH / 2) };
    spawnCowAt(world, ctx.tileGrid, tile.i, tile.j);
    ctx.audio.play('spawn');
    ctx.updateHud();
    return;
  }
  if (e.code === 'KeyG' || e.code === 'KeyJ') {
    const tile = state.lastPick ?? { i: Math.floor(ctx.gridW / 2), j: Math.floor(ctx.gridH / 2) };
    const kind = e.code === 'KeyG' ? 'stone' : 'food';
    addItemToTile(world, ctx.tileGrid, kind, tile.i, tile.j);
    ctx.itemInstancer.markDirty();
    ctx.audio.play('drop');
    ctx.updateHud();
    return;
  }
  if (e.code === 'KeyK') {
    await saveGame(ctx);
    return;
  }
  if (e.code === 'KeyL') {
    await loadGame(ctx);
    return;
  }
  // T/Shift+T scrub time of day; Y cycles weather. Both debug-only (this
  // branch is guarded by `state.debugEnabled` above).
  if (e.code === 'KeyT') {
    ctx.timeOfDay.offsetHours(e.shiftKey ? -2 : 2);
    ctx.audio.play('cycle');
    ctx.updateHud();
    return;
  }
  if (e.code === 'KeyY') {
    ctx.weather.cycle(1);
    ctx.audio.play('toggle_on');
    ctx.updateHud();
  }
}

/** @param {InputCtx} ctx */
async function saveGame(ctx) {
  try {
    const snapshot = serializeState(ctx.tileGrid, ctx.world);
    const json = JSON.stringify(snapshot);
    const gz = await gzipString(json);
    const b64 = bytesToBase64(gz);
    localStorage.setItem(`save:v${CURRENT_VERSION}`, b64);
    console.log(
      '[save] ok — tiles:',
      ctx.tileGrid.W * ctx.tileGrid.H,
      'cows:',
      snapshot.cows.length,
      'gz bytes:',
      gz.length,
    );
    ctx.audio.play('save');
  } catch (err) {
    console.error('[save] failed:', err);
    ctx.audio.play('deny');
  }
}

/** @param {InputCtx} ctx */
async function loadGame(ctx) {
  const {
    world,
    tileGrid,
    pathCache,
    jobBoard,
    scene,
    treeInstancer,
    itemInstancer,
    stockpileOverlay,
    state,
  } = ctx;
  try {
    let b64 = null;
    for (let v = CURRENT_VERSION; v >= 2; v--) {
      b64 = localStorage.getItem(`save:v${v}`);
      if (b64) break;
    }
    if (!b64) {
      console.warn('[load] no save in localStorage');
      ctx.audio.play('deny');
      return;
    }
    const bin = base64ToBytes(b64);
    const json = await gunzipBytes(bin);
    const parsed = JSON.parse(json);
    const migrated = loadState(parsed);
    const loaded = hydrateTileGrid(migrated);
    tileGrid.elevation.set(loaded.elevation);
    tileGrid.biome.set(loaded.biome);
    tileGrid.stockpile.set(loaded.stockpile);
    tileGrid.wall.set(loaded.wall);
    tileGrid.door.set(loaded.door);
    tileGrid.torch.set(loaded.torch);
    tileGrid.roof.set(loaded.roof);
    tileGrid.ignoreRoof.set(loaded.ignoreRoof);
    tileGrid.occupancy.fill(0);
    pathCache.clear();
    despawnAllComp(world, 'Cow');
    despawnAllComp(world, 'Tree');
    despawnAllComp(world, 'Item');
    despawnAllComp(world, 'BuildSite');
    despawnAllComp(world, 'Wall');
    despawnAllComp(world, 'Door');
    despawnAllComp(world, 'Torch');
    despawnAllComp(world, 'Roof');
    jobBoard.jobs.length = 0;
    if (migrated.trees.length === 0) {
      // Pre-v5 save had no tree list — seed a fresh scatter so the world
      // isn't bare.
      spawnInitialTrees(world, tileGrid, ctx.treeCount);
    } else {
      hydrateTrees(world, tileGrid, jobBoard, migrated);
    }
    hydrateItems(world, tileGrid, migrated);
    hydrateBuildSites(world, tileGrid, migrated);
    hydrateWalls(world, tileGrid, jobBoard, migrated);
    hydrateDoors(world, tileGrid, jobBoard, migrated);
    hydrateTorches(world, tileGrid, jobBoard, migrated);
    hydrateRoofs(world, tileGrid, jobBoard, migrated);
    ctx.rooms.rebuild();
    ctx.roomOverlay.markDirty();
    ctx.ignoreRoofOverlay.markDirty();
    ctx.roofInstancer.markDirty();
    treeInstancer.markDirty();
    itemInstancer.markDirty();
    stockpileOverlay.markDirty();
    ctx.buildSiteInstancer?.markDirty();
    ctx.wallInstancer?.markDirty();
    hydrateCows(world, migrated);
    // Job board was cleared above; any serialized cow job references are
    // stale. Reset so the brain re-picks from the fresh board.
    for (const { components } of world.query(['Cow', 'Job', 'Path'])) {
      components.Job.kind = 'none';
      components.Job.state = 'idle';
      components.Job.payload = {};
      components.Path.steps.length = 0;
      components.Path.index = 0;
    }
    const fresh = buildTileMesh(tileGrid);
    scene.remove(state.tileMesh);
    state.tileMesh.geometry.dispose();
    state.tileMesh = fresh;
    scene.add(state.tileMesh);
    state.selectedCows.clear();
    state.primaryCow = null;
    console.log(
      '[load] restored',
      tileGrid.W,
      'x',
      tileGrid.H,
      'tiles, cows:',
      migrated.cows.length,
    );
    ctx.audio.play('load');
    ctx.updateHud();
  } catch (err) {
    console.error('[load] failed:', err);
    ctx.audio.play('deny');
  }
}
