/**
 * Keyboard hotkey table + dispatcher.
 *
 * Lives here instead of inline in a 200-line switch so "what does T do"
 * is a grep away. Entries are ordered — the dispatcher runs the first
 * whose `match` returns true. A pure `Map<keycode, fn>` doesn't fit:
 *   - Q/E have three behaviors (FP cycle, follow cycle, otherwise pass),
 *     dispatched by mode.
 *   - Pan keys intentionally break follow AND still let RtsCamera process
 *     the event (`fallthrough: true`).
 *   - The bottom third is debug-gated; match closures hold that.
 */

import { buildTileMesh, buildWaterSurface, disposeTileMesh } from '../render/tileMesh.js';
import { TICKS_PER_SIM_HOUR } from '../sim/calendar.js';
import { spawnInitialTrees } from '../systems/trees.js';
import { addItemToTile } from '../world/items.js';
import { CURRENT_VERSION } from '../world/migrations/index.js';
import {
  gunzipBytes,
  gzipString,
  hydrateBeds,
  hydrateBoulders,
  hydrateBuildSites,
  hydrateCows,
  hydrateCrops,
  hydrateDoors,
  hydrateEasels,
  hydrateFloors,
  hydrateFurnaces,
  hydrateItems,
  hydratePaintings,
  hydrateRoofs,
  hydrateStoves,
  hydrateTileGrid,
  hydrateTorches,
  hydrateTrees,
  hydrateWallArt,
  hydrateWalls,
  loadState,
  serializeState,
} from '../world/persist.js';
import { toggleDraft } from './drafting.js';
import { spawnCowAt } from './spawn.js';
import {
  allCowIds,
  base64ToBytes,
  bytesToBase64,
  despawnAllComp,
  toggleForbiddenOnStacks,
} from './utils.js';

/** @typedef {import('./input.js').InputCtx} InputCtx */

/**
 * @typedef HotkeyEntry
 * @property {(e: KeyboardEvent, ctx: InputCtx) => boolean} match
 * @property {(ctx: InputCtx, e: KeyboardEvent) => void | Promise<void>} run
 * @property {boolean} [fallthrough]  don't stop the dispatcher after running
 *
 * Arg order differs on purpose: `match` is event-dominant (most entries only
 * inspect `e.code`), `run` is context-dominant (most entries ignore `e`).
 * Putting the usually-used arg first lets the usually-unused one be omitted.
 */

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

/** @type {HotkeyEntry[]} */
export const HOTKEYS = [
  // P — toggle the debug overlay (and the last stretch of debug-gated keys).
  {
    match: (e) => e.code === 'KeyP',
    run: (ctx) => {
      ctx.state.debugEnabled = !ctx.state.debugEnabled;
      ctx.audio.play(ctx.state.debugEnabled ? 'toggle_on' : 'toggle_off');
      ctx.applyDebugVisibility();
      ctx.updateHud();
    },
  },
  // V — hide/show built roofs so the player can see what's underneath.
  {
    match: (e) => e.code === 'KeyV',
    run: (ctx) => {
      ctx.state.roofsVisible = ctx.state.roofsVisible === false;
      ctx.audio.play(ctx.state.roofsVisible ? 'toggle_on' : 'toggle_off');
      ctx.applyDebugVisibility();
      ctx.updateHud();
    },
  },
  // H — toggle first-person. Exiting recenters overhead on the viewed cow
  // so we don't dump the player back at the corner they entered from.
  {
    match: (e) => e.code === 'KeyH',
    run: (ctx) => {
      const { state, fpCamera, rts, world } = ctx;
      if (fpCamera.active) {
        if (fpCamera.cowId !== null) {
          const viewedPos = world.get(fpCamera.cowId, 'Position');
          if (viewedPos) rts.focus.set(viewedPos.x, viewedPos.y, viewedPos.z);
        }
        fpCamera.exit();
        ctx.audio.play('toggle_off');
      } else if (state.primaryCow !== null) {
        fpCamera.enter(state.primaryCow);
        // Drop the world selection — the viewed cow is tracked via fpCamera.cowId
        // while FP is active; leaving them selected would re-target ghost
        // commands at a cow the player can't see highlighted.
        state.selectedCows.clear();
        state.primaryCow = null;
        ctx.audio.play('toggle_on');
      } else {
        ctx.audio.play('deny');
      }
    },
  },
  // Q/E in FP — cycle the viewed cow. Must match before the follow variant
  // below so FP wins when both are somehow true.
  {
    match: (e, ctx) => (e.code === 'KeyQ' || e.code === 'KeyE') && ctx.fpCamera.active,
    run: (ctx, e) => {
      ctx.fpCamera.cycle(e.code === 'KeyE' ? 1 : -1);
      ctx.audio.play('cycle');
    },
  },
  // F while stacks are selected — toggle forbidden on the whole selection.
  // Must match before the follow-F below so the context wins.
  {
    match: (e, ctx) => e.code === 'KeyF' && ctx.state.selectedItems.size > 0,
    run: (ctx) => {
      const target = toggleForbiddenOnStacks(ctx.world, ctx.state.selectedItems, ctx.jobBoard);
      if (target === null) return;
      ctx.itemInstancer.markDirty();
      ctx.itemSelectionViz.markDirty();
      ctx.audio.play(target ? 'toggle_off' : 'toggle_on');
      ctx.updateHud();
    },
  },
  // B/C/X/L/Y/F on world objects — route the key to the order registered
  // under it in objectTypes.js. Chord definitions live alongside each order
  // so adding a new verb only touches one file.
  {
    match: (e, ctx) =>
      (e.code === 'KeyB' ||
        e.code === 'KeyC' ||
        e.code === 'KeyX' ||
        e.code === 'KeyL' ||
        e.code === 'KeyY' ||
        e.code === 'KeyF') &&
      !!ctx.objectPanel &&
      ctx.state.selectedObjects.size > 0,
    run: (ctx, e) => {
      ctx.objectPanel?.runKey(e.code);
    },
  },
  // Build palette entry hotkey — only fires when a category is open and the
  // key matches a per-buildable letter in that category. Must come before
  // the category/global handlers so T-in-Orders activates chop rather than
  // getting eaten by something generic.
  {
    match: (e, ctx) => ctx.buildTab.findEntryByHotkey(e.code) !== null,
    run: (ctx, e) => {
      const entry = ctx.buildTab.findEntryByHotkey(e.code);
      if (entry) ctx.buildTab.activateEntry(entry.id);
    },
  },
  // Build palette category hotkey — runs when the palette is open, picks
  // which column of buildables is showing.
  {
    match: (e, ctx) =>
      ctx.buildTab.state.open && ctx.buildTab.findCategoryByHotkey(e.code) !== null,
    run: (ctx, e) => {
      const cat = ctx.buildTab.findCategoryByHotkey(e.code);
      if (cat) ctx.buildTab.openCategory(cat.id);
    },
  },
  // B — toggle the build palette.
  {
    match: (e) => e.code === 'KeyB',
    run: (ctx) => {
      ctx.buildTab.toggleOpen();
      ctx.audio.play(ctx.buildTab.state.open ? 'toggle_on' : 'toggle_off');
    },
  },
  // C — activate Cancel anywhere (no category needs to be open).
  {
    match: (e) => e.code === 'KeyC',
    run: (ctx) => {
      ctx.buildTab.activateEntry('cancel');
    },
  },
  // X — activate Demolish anywhere (no category needs to be open).
  {
    match: (e) => e.code === 'KeyX',
    run: (ctx) => {
      ctx.buildTab.activateEntry('deconstruct');
    },
  },
  // F — toggle camera follow. Auto-selects the first cow if nothing's
  // selected so pressing F on a fresh world still does something.
  {
    match: (e) => e.code === 'KeyF',
    run: (ctx) => {
      const { state, world } = ctx;
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
    },
  },
  // Q/E while follow is engaged — cycle primary; camera auto-hands off.
  {
    match: (e, ctx) => (e.code === 'KeyQ' || e.code === 'KeyE') && ctx.state.followEnabled,
    run: (ctx, e) => {
      const { state, world } = ctx;
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
    },
  },
  // Pan keys while follow is engaged — drop the latch and let the event
  // keep flowing so RtsCamera's own listener still pans on the same press.
  {
    match: (e, ctx) => ctx.state.followEnabled && PAN_KEYS.has(e.code),
    run: (ctx) => {
      ctx.state.followEnabled = false;
      ctx.updateHud();
    },
    fallthrough: true,
  },
  // Q/E otherwise — bump the active Z layer. Last of the Q/E trio so FP and
  // follow win first; this is what the mobile ▲/▼ buttons also route through.
  {
    match: (e, ctx) =>
      (e.code === 'KeyQ' || e.code === 'KeyE') && !!ctx.setActiveZ && !!ctx.tileWorld,
    run: (ctx, e) => {
      const delta = e.code === 'KeyE' ? 1 : -1;
      ctx.setActiveZ?.(/** @type {number} */ (ctx.tileWorld?.activeZ ?? 0) + delta);
    },
  },
  // R — toggle draft. In FP toggles the viewed cow; otherwise toggles the
  // whole selection (mixed selections all go to "drafted" via toggleDraft).
  {
    match: (e) => e.code === 'KeyR',
    run: (ctx) => {
      const { state, fpCamera, world } = ctx;
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
        const primary = state.primaryCow !== null ? world.get(state.primaryCow, 'Cow') : null;
        ctx.audio.play(primary?.drafted ? 'draft' : 'undraft');
        ctx.updateHud();
      } else {
        ctx.audio.play('deny');
      }
    },
  },
  // 1/2/3/4 — sim speed multiplier. 4 jumps to 6x (skipping 4x/5x) since
  // the useful tier is "much faster" for long hauls.
  {
    match: (e) => SPEED_KEYS[e.code] !== undefined,
    run: (ctx, e) => {
      ctx.loop.setSpeed(SPEED_KEYS[e.code]);
      ctx.audio.play('cycle');
      ctx.updateHud();
    },
  },
  // M — mute/unmute background music. SFX continues either way; the
  // confirmation click plays in both directions since it isn't muted.
  {
    match: (e) => e.code === 'KeyM',
    run: (ctx) => {
      const muted = ctx.audio.toggleMusicMute();
      ctx.audio.play(muted ? 'toggle_off' : 'toggle_on');
    },
  },
  // Space — pause toggle. Render keeps running so UI (build tab, portraits,
  // designators) stays interactive while the sim is frozen.
  {
    match: (e) => e.code === 'Space',
    run: (ctx, e) => {
      e.preventDefault();
      const { state, loop } = ctx;
      if (loop.speed > 0) {
        state.pausedSpeed = loop.speed;
        loop.setSpeed(0);
        ctx.audio.play('toggle_off');
      } else {
        loop.setSpeed(state.pausedSpeed ?? 1);
        ctx.audio.play('toggle_on');
      }
      ctx.updateHud();
    },
  },
  // ───── debug-gated below ─────
  // N — spawn a cow at the last picked tile (falls back to grid center).
  {
    match: (e, ctx) => ctx.state.debugEnabled && e.code === 'KeyN',
    run: (ctx) => {
      const tile = ctx.state.lastPick ?? {
        i: Math.floor(ctx.gridW / 2),
        j: Math.floor(ctx.gridH / 2),
      };
      spawnCowAt(ctx.world, ctx.tileGrid, tile.i, tile.j, ctx.loop.tick);
      ctx.audio.play('spawn');
      ctx.updateHud();
    },
  },
  // G/J — drop a stone/corn stack at the last picked tile.
  {
    match: (e, ctx) => ctx.state.debugEnabled && (e.code === 'KeyG' || e.code === 'KeyJ'),
    run: (ctx, e) => {
      const tile = ctx.state.lastPick ?? {
        i: Math.floor(ctx.gridW / 2),
        j: Math.floor(ctx.gridH / 2),
      };
      const kind = e.code === 'KeyG' ? 'stone' : 'corn';
      addItemToTile(ctx.world, ctx.tileGrid, kind, tile.i, tile.j);
      ctx.itemInstancer.markDirty();
      ctx.audio.play('drop');
      ctx.updateHud();
    },
  },
  // K — save snapshot to localStorage.
  {
    match: (e, ctx) => ctx.state.debugEnabled && e.code === 'KeyK',
    run: (ctx) => saveGame(ctx),
  },
  // L — load snapshot from localStorage.
  {
    match: (e, ctx) => ctx.state.debugEnabled && e.code === 'KeyL',
    run: (ctx) => loadGame(ctx),
  },
  // T / Shift+T — scrub sim clock ±2 hours. Drives timeOfDay + calendar +
  // cow ageing via the shared tick stream, so the sun and the date advance
  // together.
  {
    match: (e, ctx) => ctx.state.debugEnabled && e.code === 'KeyT',
    run: (ctx, e) => {
      const delta = (e.shiftKey ? -2 : 2) * TICKS_PER_SIM_HOUR;
      ctx.state.tickOffset = (ctx.state.tickOffset ?? 0) + delta;
      ctx.audio.play('cycle');
      ctx.updateHud();
    },
  },
  // Y — cycle weather.
  {
    match: (e, ctx) => ctx.state.debugEnabled && e.code === 'KeyY',
    run: (ctx) => {
      ctx.weather.cycle(1);
      ctx.audio.play('toggle_on');
    },
  },
];

/**
 * Run the hotkey chain against a keyboard event. First matching entry runs;
 * dispatcher stops unless the entry opts into `fallthrough`.
 *
 * @param {InputCtx} ctx
 * @param {KeyboardEvent} e
 */
export async function dispatch(ctx, e) {
  for (const entry of HOTKEYS) {
    if (!entry.match(e, ctx)) continue;
    await entry.run(ctx, e);
    if (!entry.fallthrough) return;
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
    boulderInstancer,
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
    tileGrid.floor.set(loaded.floor);
    tileGrid.farmZone.set(loaded.farmZone);
    tileGrid.tilled.set(loaded.tilled);
    tileGrid.occupancy.fill(0);
    // Bulk set() bypasses the wall/door/torch/roof setters, so the derived
    // counters + torchTiles Set are stale until rebuilt.
    tileGrid.recomputeCounts();
    ctx.stockpileZones.hydrateFromGrid();
    pathCache.clear();
    despawnAllComp(world, 'Cow');
    despawnAllComp(world, 'Tree');
    despawnAllComp(world, 'Boulder');
    despawnAllComp(world, 'Item');
    despawnAllComp(world, 'BuildSite');
    despawnAllComp(world, 'Wall');
    despawnAllComp(world, 'Door');
    despawnAllComp(world, 'Torch');
    despawnAllComp(world, 'Roof');
    despawnAllComp(world, 'Floor');
    despawnAllComp(world, 'Crop');
    despawnAllComp(world, 'Furnace');
    despawnAllComp(world, 'Easel');
    despawnAllComp(world, 'Stove');
    despawnAllComp(world, 'Painting');
    jobBoard.clear();
    if (migrated.trees.length === 0) {
      // Pre-v5 save had no tree list — seed a fresh scatter so the world
      // isn't bare.
      spawnInitialTrees(world, tileGrid, ctx.treeCount);
    } else {
      hydrateTrees(world, tileGrid, jobBoard, migrated);
    }
    hydrateBoulders(world, tileGrid, jobBoard, migrated);
    hydrateItems(world, tileGrid, migrated);
    hydrateBuildSites(world, tileGrid, migrated);
    hydrateWalls(world, tileGrid, jobBoard, migrated);
    hydrateDoors(world, tileGrid, jobBoard, migrated);
    hydrateTorches(world, tileGrid, jobBoard, migrated);
    hydrateRoofs(world, tileGrid, jobBoard, migrated);
    hydrateFloors(world, tileGrid, jobBoard, migrated);
    hydrateCrops(world, tileGrid, jobBoard, migrated);
    hydrateFurnaces(world, tileGrid, jobBoard, migrated);
    hydrateEasels(world, tileGrid, jobBoard, migrated);
    hydrateStoves(world, tileGrid, jobBoard, migrated);
    hydrateBeds(world, tileGrid, jobBoard, migrated);
    hydratePaintings(world, tileGrid, migrated);
    hydrateWallArt(world, tileGrid, migrated);
    ctx.rooms.rebuild();
    ctx.roomOverlay.markDirty();
    ctx.ignoreRoofOverlay.markDirty();
    ctx.roofInstancer.markDirty();
    ctx.floorInstancer.markDirty();
    ctx.flowerInstancer?.markDirty();
    ctx.ambientParticles?.markFlowersDirty();
    treeInstancer.markDirty();
    boulderInstancer.markDirty();
    itemInstancer.markDirty();
    stockpileOverlay.markDirty();
    ctx.farmZoneOverlay.markDirty();
    ctx.tilledOverlay.markDirty();
    ctx.buildSiteInstancer?.markDirty();
    ctx.wallInstancer?.markDirty();
    ctx.cropInstancer.markDirty();
    ctx.furnaceInstancer?.markDirty();
    ctx.wallArtInstancer?.markDirty();
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
    disposeTileMesh(state.tileMesh);
    state.tileMesh = fresh;
    scene.add(state.tileMesh);
    if (state.waterMesh) {
      scene.remove(state.waterMesh);
      state.waterMesh.geometry.dispose();
      const mat = /** @type {import('three').Material} */ (state.waterMesh.material);
      mat.dispose();
    }
    state.waterMesh = buildWaterSurface(tileGrid);
    if (state.waterMesh) scene.add(state.waterMesh);
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
