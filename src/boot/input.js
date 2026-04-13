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
  hydrateCows,
  hydrateItems,
  hydrateTileGrid,
  hydrateTrees,
  loadState,
  serializeState,
} from '../world/persist.js';
import { toggleDraft } from './drafting.js';
import { spawnCowAt } from './spawn.js';
import { allCowIds, base64ToBytes, bytesToBase64, despawnAllComp } from './utils.js';

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
 * @property {number} treeCount
 * @property {number} gridW
 * @property {number} gridH
 * @property {BootState} state
 * @property {{ play: (kind: string) => void }} audio
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
    if (fpCamera.active && fpCamera.cowId !== null) {
      toggleDraft(world, [fpCamera.cowId]);
      const cow = world.get(fpCamera.cowId, 'Cow');
      ctx.audio.play(cow?.drafted ? 'draft' : 'undraft');
      ctx.updateHud();
      return;
    }
    if (state.selectedCows.size > 0) {
      toggleDraft(world, [...state.selectedCows]);
      // Post-toggle, primary's state reflects the new majority target.
      const primary = state.primaryCow !== null ? world.get(state.primaryCow, 'Cow') : null;
      ctx.audio.play(primary?.drafted ? 'draft' : 'undraft');
      ctx.updateHud();
    } else {
      ctx.audio.play('deny');
    }
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
    tileGrid.occupancy.fill(0);
    pathCache.clear();
    despawnAllComp(world, 'Cow');
    despawnAllComp(world, 'Tree');
    despawnAllComp(world, 'Item');
    jobBoard.jobs.length = 0;
    if (migrated.trees.length === 0) {
      // Pre-v5 save had no tree list — seed a fresh scatter so the world
      // isn't bare.
      spawnInitialTrees(world, tileGrid, ctx.treeCount);
    } else {
      hydrateTrees(world, tileGrid, jobBoard, migrated);
    }
    hydrateItems(world, tileGrid, migrated);
    treeInstancer.markDirty();
    itemInstancer.markDirty();
    stockpileOverlay.markDirty();
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
