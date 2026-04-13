/**
 * Main entry: tile world + cows + jobs + save/load.
 *
 * Stress test stays behind ?stress=N; cow count overridable via ?cows=N
 * (default 10).
 */

import { countDrafted, toggleDraft } from './boot/drafting.js';
import { readBootParams } from './boot/params.js';
import { spawnCowAt, spawnInitialCows } from './boot/spawn.js';
import {
  allCowIds,
  base64ToBytes,
  bytesToBase64,
  countComp,
  despawnAllComp,
} from './boot/utils.js';
import { registerComponents } from './components/index.js';
import { Scheduler } from './ecs/schedule.js';
import { World } from './ecs/world.js';
import { JobBoard } from './jobs/board.js';
import { makeHaulPostingSystem } from './jobs/haul.js';
import { ChopDesignator } from './render/chopDesignator.js';
import { createCowCamOverlay } from './render/cowCamOverlay.js';
import { createCowInstancer } from './render/cowInstancer.js';
import { createCowNameTags } from './render/cowNameTags.js';
import { CowSelector } from './render/cowSelector.js';
import { createDraftBadge } from './render/draftBadge.js';
import { FirstPersonCamera } from './render/firstPersonCamera.js';
import { createItemInstancer } from './render/itemInstancer.js';
import { createItemLabels } from './render/itemLabels.js';
import { CowMoveCommand } from './render/moveCommand.js';
import { createPickTileOverlay } from './render/pickTileOverlay.js';
import { TilePicker } from './render/picker.js';
import { RtsCamera } from './render/rtsCamera.js';
import { createScene } from './render/scene.js';
import { SelectionBox } from './render/selectionBox.js';
import { createSelectionViz } from './render/selectionViz.js';
import { StockpileDesignator } from './render/stockpileDesignator.js';
import { createStockpileOverlay } from './render/stockpileOverlay.js';
import { createStressInstancer } from './render/stressInstancer.js';
import { buildTileMesh } from './render/tileMesh.js';
import { createTreeInstancer } from './render/treeInstancer.js';
import { SimLoop } from './sim/loop.js';
import { PathCache, defaultWalkable } from './sim/pathfinding.js';
import { spawnStressEntities, stressBounce } from './stress.js';
import { makeCowBrainSystem, makeCowFollowPathSystem, makeHungerSystem } from './systems/cow.js';
import { applyVelocity, snapshotPositions } from './systems/movement.js';
import { spawnInitialTrees } from './systems/trees.js';
import { tileToWorld } from './world/coords.js';
import { ITEM_KINDS, addItemToTile } from './world/items.js';
import { CURRENT_VERSION } from './world/migrations/index.js';
import {
  gunzipBytes,
  gzipString,
  hydrateCows,
  hydrateItems,
  hydrateTileGrid,
  hydrateTrees,
  loadState,
  serializeState,
} from './world/persist.js';
import { BIOME, TileGrid } from './world/tileGrid.js';

const BIOME_NAMES = /** @type {Record<number, string>} */ ({
  [BIOME.GRASS]: 'grass',
  [BIOME.DIRT]: 'dirt',
  [BIOME.STONE]: 'stone',
  [BIOME.SAND]: 'sand',
});

const { stressCount, cowCount, treeCount, gridW, gridH } = readBootParams();

const tileGrid = new TileGrid(gridW, gridH);
tileGrid.generateSimpleHeightmap(8);

const world = new World();
registerComponents(world);

const pathCache = new PathCache(tileGrid, defaultWalkable);
const jobBoard = new JobBoard();

// Forward-declared so the brain can poke the renderers once they're
// constructed below.
let onWorldChopComplete = () => {};
let onWorldItemChange = () => {};
// Forward-declared so cowFollowPath can ask the FP camera for the currently
// driven cow without a construction-order tangle.
/** @type {() => number | null} */
let getDrivingCowId = () => null;

const scheduler = new Scheduler();
scheduler.add(snapshotPositions);
scheduler.add(
  makeCowBrainSystem({
    grid: tileGrid,
    paths: pathCache,
    walkable: defaultWalkable,
    board: jobBoard,
    onChopComplete: () => onWorldChopComplete(),
    onItemChange: () => onWorldItemChange(),
  }),
);
scheduler.add(
  makeCowFollowPathSystem({
    grid: tileGrid,
    paths: pathCache,
    walkable: defaultWalkable,
    drivingCowId: () => getDrivingCowId(),
  }),
);
scheduler.add(applyVelocity);
if (stressCount > 0) scheduler.add(stressBounce);
scheduler.add(makeHungerSystem());
scheduler.add(makeHaulPostingSystem(jobBoard, tileGrid));

if (stressCount > 0) spawnStressEntities(world, stressCount);
spawnInitialTrees(world, tileGrid, treeCount);
spawnInitialCows(world, tileGrid, cowCount);

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
const { renderer, scene, camera } = createScene(canvas);
let tileMesh = buildTileMesh(tileGrid);
scene.add(tileMesh);
const rts = new RtsCamera(camera, canvas);
const cowInstancer = createCowInstancer(scene, 256);
const cowNameTags = createCowNameTags(scene);
const selectionViz = createSelectionViz(scene);
const treeInstancer = createTreeInstancer(scene, 2048);
const itemInstancer = createItemInstancer(scene, 1024);
const itemLabels = createItemLabels(scene);
const stockpileOverlay = createStockpileOverlay(scene, gridW * gridH);
const pickTileOverlay = createPickTileOverlay(scene);

onWorldChopComplete = () => {
  treeInstancer.markDirty();
  itemInstancer.markDirty();
  pathCache.clear();
};
onWorldItemChange = () => {
  itemInstancer.markDirty();
};

const selectedCows = /** @type {Set<number>} */ (new Set());
let primaryCow = /** @type {number | null} */ (null);

// Marquee BEFORE CowSelector so its capture-phase handler swallows the post-drag click first.
new SelectionBox(canvas, camera, world, (ids, additive) => {
  if (!additive) {
    selectedCows.clear();
    primaryCow = null;
  }
  for (const id of ids) {
    selectedCows.add(id);
    primaryCow = id;
  }
  updateHud();
});

new CowSelector(
  canvas,
  camera,
  cowInstancer,
  () => tileMesh,
  world,
  (id, additive) => {
    if (id === null) {
      // Empty-space click: plain clears, shift preserves the current set.
      if (!additive) {
        selectedCows.clear();
        primaryCow = null;
      }
    } else if (additive) {
      if (selectedCows.has(id)) {
        selectedCows.delete(id);
        if (primaryCow === id) {
          primaryCow =
            selectedCows.size > 0
              ? /** @type {number} */ (selectedCows.values().next().value)
              : null;
        }
      } else {
        selectedCows.add(id);
        primaryCow = id;
      }
    } else {
      selectedCows.clear();
      selectedCows.add(id);
      primaryCow = id;
    }
    updateHud();
  },
);

let lastPick = /** @type {{ i: number, j: number } | null} */ (null);
new TilePicker(
  canvas,
  camera,
  () => tileMesh,
  { W: gridW, H: gridH },
  (hit) => {
    lastPick = hit;
  },
);

new CowMoveCommand(
  canvas,
  camera,
  () => tileMesh,
  tileGrid,
  pathCache,
  defaultWalkable,
  world,
  () => selectedCows,
  scene,
);

/** @type {StockpileDesignator | null} */
let stockpileDesignatorRef = null;
const chopDesignator = new ChopDesignator(canvas, camera, treeInstancer, world, jobBoard, () => {
  if (chopDesignator.active && stockpileDesignatorRef) stockpileDesignatorRef.deactivate();
  updateHud();
});

const stockpileDesignator = new StockpileDesignator(
  canvas,
  camera,
  () => tileMesh,
  tileGrid,
  stockpileOverlay,
  scene,
  () => {
    if (stockpileDesignator.active) chopDesignator.deactivate();
    updateHud();
  },
);
stockpileDesignatorRef = stockpileDesignator;

const fpCamera = new FirstPersonCamera(camera, canvas, world, () => updateHud());
getDrivingCowId = () => fpCamera.drivingCowId;
const cowCamOverlay = createCowCamOverlay();
const draftBadge = createDraftBadge(scene, 256);

const stressInstancer = stressCount > 0 ? createStressInstancer(scene, stressCount) : null;

const hud = /** @type {HTMLElement} */ (document.getElementById('hud'));
let debugEnabled = true;
/**
 * Global follow toggle. When true, the overhead camera eases toward the
 * current `primaryCow` every frame — so plain-clicking or marquee-picking
 * a different cow automatically hands the camera off. Q/E cycle primary
 * while engaged; WASD/arrows disengage.
 */
let followEnabled = false;
let renderFrameCount = 0;
let renderFpsSampleStart = performance.now();
let measuredFps = 0;
let lastRenderClock = performance.now();
const startClock = performance.now();

const loop = new SimLoop({
  step(dt, tick) {
    scheduler.tick(world, tick, dt);
  },
  render(alpha) {
    const now = performance.now();
    const rdt = (now - lastRenderClock) / 1000;
    lastRenderClock = now;
    if (fpCamera.active) {
      fpCamera.update(rdt);
    } else {
      // Follow mode: ease the camera toward the interpolated render position
      // of whoever's currently `primaryCow`. Interpolating (pp→p at alpha)
      // kills the 30Hz tick quantization that caused per-frame jitter; the
      // exp lerp on top softens abrupt handoffs when the player clicks a
      // different cow across the map.
      if (followEnabled && primaryCow !== null) {
        const p = world.get(primaryCow, 'Position');
        const pp = world.get(primaryCow, 'PrevPosition') ?? p;
        if (p) {
          const tx = pp.x + (p.x - pp.x) * alpha;
          const ty = pp.y + (p.y - pp.y) * alpha;
          const tz = pp.z + (p.z - pp.z) * alpha;
          // ~80ms time constant — snappy, but smooths out direction changes.
          const k = 1 - Math.exp(-rdt * 12);
          rts.focus.x += (tx - rts.focus.x) * k;
          rts.focus.y += (ty - rts.focus.y) * k;
          rts.focus.z += (tz - rts.focus.z) * k;
        }
      }
      rts.update(rdt);
    }
    cowCamOverlay.update(fpCamera, world);
    if (stressInstancer) stressInstancer.update(world, alpha);
    const tSec = (now - startClock) / 1000;
    const hiddenCowId = fpCamera.active ? fpCamera.cowId : null;
    cowInstancer.update(world, alpha, tSec, tileGrid, hiddenCowId);
    cowNameTags.update(world, camera, alpha);
    draftBadge.update(world, tSec);
    treeInstancer.update(world, tileGrid);
    treeInstancer.updateMarkers(world, tileGrid, tSec);
    itemInstancer.update(world, tileGrid);
    itemLabels.update(world, camera, tileGrid);
    stockpileOverlay.update(tileGrid);
    pickTileOverlay.update(tileGrid, lastPick);
    pruneStaleSelections();
    selectionViz.update(world, selectedCows, alpha, tSec, tileGrid);
    renderer.render(scene, camera);
    renderFrameCount++;
    if (now - renderFpsSampleStart >= 500) {
      measuredFps = (renderFrameCount * 1000) / (now - renderFpsSampleStart);
      renderFrameCount = 0;
      renderFpsSampleStart = now;
      updateHud();
    }
  },
});

function updateHud() {
  if (!debugEnabled) {
    hud.style.display = 'none';
    return;
  }
  hud.style.display = '';
  let cowLines = ['', 'click a cow to inspect'];
  const selCount = selectedCows.size;
  if (selCount > 0 && primaryCow !== null) {
    const brain = world.get(primaryCow, 'Brain');
    const hunger = world.get(primaryCow, 'Hunger');
    const job = world.get(primaryCow, 'Job');
    const path = world.get(primaryCow, 'Path');
    const pos = world.get(primaryCow, 'Position');
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
      selectedCows.delete(primaryCow);
      primaryCow =
        selectedCows.size > 0 ? /** @type {number} */ (selectedCows.values().next().value) : null;
    }
  }
  let pickStr = 'pick: (click a tile)';
  if (lastPick && tileGrid.inBounds(lastPick.i, lastPick.j)) {
    const elev = tileGrid.getElevation(lastPick.i, lastPick.j);
    const biomeId = tileGrid.getBiome(lastPick.i, lastPick.j);
    const biomeName = BIOME_NAMES[biomeId] ?? `biome#${biomeId}`;
    const walk = defaultWalkable(tileGrid, lastPick.i, lastPick.j) ? 'yes' : 'no';
    pickStr = `pick: i=${lastPick.i} j=${lastPick.j}  elev=${elev.toFixed(1)}  biome=${biomeName}  walkable=${walk}`;
  }
  const lines = [
    'phase 4: trees + chop + stacks + eat',
    `grid: ${gridW}x${gridH}  tiles=${gridW * gridH}`,
    `sim: tick=${loop.tick}  Hz=${loop.measuredHz.toFixed(0)}/30  steps/frame=${loop.lastSteps}`,
    `render: ${measuredFps.toFixed(0)} fps`,
    `entities: ${world.entityCount}  cows=${countComp(world, 'Cow')}  trees=${countComp(world, 'Tree')}  ${itemCountsStr()}`,
    `paths: hits=${pathCache.hits} misses=${pathCache.misses}  jobs=${jobBoard.openCount}`,
    pickStr,
    ...cowLines,
    '',
  ];
  if (chopDesignator.active) {
    lines.push('** CHOP DESIGNATE — click trees to mark, C or Esc to exit **');
  }
  if (stockpileDesignator.active) {
    lines.push('** STOCKPILE DESIGNATE — LMB drag = add, Shift+drag = remove, B or Esc to exit **');
  }
  if (fpCamera.active) {
    const viewed = fpCamera.cowId;
    const viewedCow = viewed !== null ? world.get(viewed, 'Cow') : null;
    const drafted = viewedCow?.drafted === true;
    const mode = drafted ? 'DRAFTED (WASD + mouse)' : 'SPECTATE';
    lines.push(
      `** FIRST-PERSON ${mode} — cow #${viewed} — Q/E cycle, R ${drafted ? 'release' : 'draft'}, H exit **`,
    );
  } else if (followEnabled && primaryCow !== null) {
    lines.push(
      `** FOLLOWING cow #${primaryCow} — click a cow to switch, Q/E cycle, F or WASD release **`,
    );
  } else if (followEnabled) {
    lines.push('** FOLLOW MODE — click a cow to lock onto them (F to disable) **');
  }
  const draftedCount = countDrafted(world);
  lines.push(
    `drafted: ${draftedCount}`,
    'WASD/arrows = pan (hold Shift = 2x), MMB-drag = orbit, wheel = zoom',
    'LMB = select, Shift+LMB = add/toggle, RMB = move-to, Shift+RMB = queue',
    'C = chop designate,  B = stockpile designate',
    'F = toggle follow (tracks selected cow; Q/E cycle, WASD releases),  H = first-person',
    'R = draft/release selected cow(s)  (drafted cows stand still + take player orders)',
    'P = toggle debug menu  (also disables the debug-only keys below)',
    'N = spawn cow,  G = drop stone,  J = drop food  (at last clicked tile)',
    'K = save, L = load',
  );
  hud.innerText = lines.join('\n');
}

addEventListener('keydown', async (e) => {
  if (e.code === 'KeyP') {
    debugEnabled = !debugEnabled;
    applyDebugVisibility();
    updateHud();
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
    } else if (primaryCow !== null) {
      fpCamera.enter(primaryCow);
    }
    return;
  }
  if (fpCamera.active && (e.code === 'KeyQ' || e.code === 'KeyE')) {
    fpCamera.cycle(e.code === 'KeyE' ? 1 : -1);
    return;
  }
  // F toggles follow mode. Follow tracks whoever is `primaryCow` every frame,
  // so plain-clicking a different cow automatically hands off the camera. If
  // nothing is selected when F is pressed, auto-select the first cow.
  if (e.code === 'KeyF') {
    if (followEnabled) {
      followEnabled = false;
    } else {
      if (primaryCow === null) {
        const first = allCowIds(world)[0] ?? null;
        if (first !== null) {
          selectedCows.clear();
          selectedCows.add(first);
          primaryCow = first;
        }
      }
      followEnabled = primaryCow !== null;
    }
    updateHud();
    return;
  }
  // Q/E cycle the primary cow while follow is engaged. The camera follows
  // primary so cycling primary auto-hands off the camera too.
  if (followEnabled && (e.code === 'KeyQ' || e.code === 'KeyE')) {
    const cows = allCowIds(world);
    if (cows.length > 0) {
      const curIdx = primaryCow !== null ? cows.indexOf(primaryCow) : -1;
      const dir = e.code === 'KeyE' ? 1 : -1;
      const nextIdx = (curIdx + dir + cows.length) % cows.length;
      const next = cows[nextIdx];
      selectedCows.clear();
      selectedCows.add(next);
      primaryCow = next;
    }
    updateHud();
    return;
  }
  // Pan keys break follow — moving the camera manually implies "let me look
  // around" so the latch releases. Fall through so RtsCamera's own listener
  // still processes the pan on this same keydown.
  if (
    followEnabled &&
    (e.code === 'KeyW' ||
      e.code === 'KeyA' ||
      e.code === 'KeyS' ||
      e.code === 'KeyD' ||
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight')
  ) {
    followEnabled = false;
    updateHud();
    // no return — let RtsCamera handle the pan this frame
  }
  // R toggles the 'drafted' flag. In FP, toggles the viewed cow. In overhead,
  // toggles every selected cow (to the majority state's opposite so a mixed
  // selection drafts rather than thrash).
  if (e.code === 'KeyR') {
    if (fpCamera.active && fpCamera.cowId !== null) {
      toggleDraft(world, [fpCamera.cowId]);
      updateHud();
      return;
    }
    if (selectedCows.size > 0) {
      toggleDraft(world, [...selectedCows]);
      updateHud();
      return;
    }
    return;
  }
  if (!debugEnabled) return;
  if (e.code === 'KeyN') {
    const tile = lastPick ?? { i: Math.floor(gridW / 2), j: Math.floor(gridH / 2) };
    spawnCowAt(world, tileGrid, tile.i, tile.j);
    updateHud();
    return;
  }
  if (e.code === 'KeyG' || e.code === 'KeyJ') {
    const tile = lastPick ?? { i: Math.floor(gridW / 2), j: Math.floor(gridH / 2) };
    const kind = e.code === 'KeyG' ? 'stone' : 'food';
    addItemToTile(world, tileGrid, kind, tile.i, tile.j);
    itemInstancer.markDirty();
    updateHud();
    return;
  }
  if (e.code === 'KeyK') {
    try {
      const state = serializeState(tileGrid, world);
      const json = JSON.stringify(state);
      const gz = await gzipString(json);
      const b64 = bytesToBase64(gz);
      localStorage.setItem(`save:v${CURRENT_VERSION}`, b64);
      console.log(
        '[save] ok — tiles:',
        tileGrid.W * tileGrid.H,
        'cows:',
        state.cows.length,
        'gz bytes:',
        gz.length,
      );
    } catch (err) {
      console.error('[save] failed:', err);
    }
  }
  if (e.code === 'KeyL') {
    try {
      let b64 = null;
      for (let v = CURRENT_VERSION; v >= 2; v--) {
        b64 = localStorage.getItem(`save:v${v}`);
        if (b64) break;
      }
      if (!b64) {
        console.warn('[load] no save in localStorage');
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
        spawnInitialTrees(world, tileGrid, treeCount);
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
      scene.remove(tileMesh);
      tileMesh.geometry.dispose();
      tileMesh = fresh;
      scene.add(tileMesh);
      selectedCows.clear();
      primaryCow = null;
      console.log(
        '[load] restored',
        tileGrid.W,
        'x',
        tileGrid.H,
        'tiles, cows:',
        migrated.cows.length,
      );
      updateHud();
    } catch (err) {
      console.error('[load] failed:', err);
    }
  }
});

/**
 * Mirror the debug flag out to the world-space overlays. Kept as one place
 * so a future overlay just needs to add a line here instead of chasing the
 * flag through the keydown handler.
 */
function applyDebugVisibility() {
  cowNameTags.setVisible(debugEnabled);
  itemLabels.setVisible(debugEnabled);
  stockpileOverlay.setVisible(debugEnabled);
  pickTileOverlay.setVisible(debugEnabled);
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
  for (const id of selectedCows) {
    if (!world.get(id, 'Position')) selectedCows.delete(id);
  }
  if (primaryCow !== null && !selectedCows.has(primaryCow)) {
    primaryCow =
      selectedCows.size > 0 ? /** @type {number} */ (selectedCows.values().next().value) : null;
  }
}

loop.start();
updateHud();
