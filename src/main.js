/**
 * Main entry: tile world + cows + jobs + save/load.
 *
 * Stress test stays behind ?stress=N; cow count overridable via ?cows=N
 * (default 10).
 */

import { countDrafted } from './boot/drafting.js';
import { installKeyboard } from './boot/input.js';
import { readBootParams } from './boot/params.js';
import { spawnInitialCows } from './boot/spawn.js';
import { countComp } from './boot/utils.js';
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
import { ITEM_KINDS } from './world/items.js';
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

/**
 * Mutable state shared across selection callbacks, HUD, render loop, and the
 * keyboard handler. Kept on one object so `input.js` can mutate the same
 * primaryCow/followEnabled/tileMesh that HUD + render observe.
 *
 * @type {import('./boot/input.js').BootState}
 */
const state = {
  debugEnabled: true,
  // Global follow toggle. When true, the overhead camera eases toward the
  // current `primaryCow` every frame — so plain-clicking or marquee-picking
  // a different cow automatically hands the camera off. Q/E cycle primary
  // while engaged; WASD/arrows disengage.
  followEnabled: false,
  primaryCow: null,
  selectedCows: new Set(),
  lastPick: null,
  tileMesh: buildTileMesh(tileGrid),
};
scene.add(state.tileMesh);

// Marquee BEFORE CowSelector so its capture-phase handler swallows the post-drag click first.
new SelectionBox(canvas, camera, world, (ids, additive) => {
  if (!additive) {
    state.selectedCows.clear();
    state.primaryCow = null;
  }
  for (const id of ids) {
    state.selectedCows.add(id);
    state.primaryCow = id;
  }
  updateHud();
});

new CowSelector(
  canvas,
  camera,
  cowInstancer,
  () => state.tileMesh,
  world,
  (id, additive) => {
    if (id === null) {
      // Empty-space click: plain clears, shift preserves the current set.
      if (!additive) {
        state.selectedCows.clear();
        state.primaryCow = null;
      }
    } else if (additive) {
      if (state.selectedCows.has(id)) {
        state.selectedCows.delete(id);
        if (state.primaryCow === id) {
          state.primaryCow =
            state.selectedCows.size > 0
              ? /** @type {number} */ (state.selectedCows.values().next().value)
              : null;
        }
      } else {
        state.selectedCows.add(id);
        state.primaryCow = id;
      }
    } else {
      state.selectedCows.clear();
      state.selectedCows.add(id);
      state.primaryCow = id;
    }
    updateHud();
  },
);

new TilePicker(
  canvas,
  camera,
  () => state.tileMesh,
  { W: gridW, H: gridH },
  (hit) => {
    state.lastPick = hit;
  },
);

new CowMoveCommand(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  pathCache,
  defaultWalkable,
  world,
  () => state.selectedCows,
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
  () => state.tileMesh,
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
      if (state.followEnabled && state.primaryCow !== null) {
        const p = world.get(state.primaryCow, 'Position');
        const pp = world.get(state.primaryCow, 'PrevPosition') ?? p;
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
    pickTileOverlay.update(tileGrid, state.lastPick);
    pruneStaleSelections();
    selectionViz.update(world, state.selectedCows, alpha, tSec, tileGrid);
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
    'C = chop designate,  B = stockpile designate',
    'F = toggle follow (tracks selected cow; Q/E cycle, WASD releases),  H = first-person',
    'R = draft/release selected cow(s)  (drafted cows stand still + take player orders)',
    'P = toggle debug menu  (also disables the debug-only keys below)',
    'N = spawn cow,  G = drop stone,  J = drop food  (at last clicked tile)',
    'K = save, L = load',
  );
  hud.innerText = lines.join('\n');
}

/**
 * Mirror the debug flag out to the world-space overlays. Kept as one place
 * so a future overlay just needs to add a line here instead of chasing the
 * flag through the keydown handler.
 */
function applyDebugVisibility() {
  cowNameTags.setVisible(state.debugEnabled);
  itemLabels.setVisible(state.debugEnabled);
  stockpileOverlay.setVisible(state.debugEnabled);
  pickTileOverlay.setVisible(state.debugEnabled);
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

installKeyboard({
  world,
  tileGrid,
  pathCache,
  jobBoard,
  scene,
  fpCamera,
  rts,
  itemInstancer,
  treeInstancer,
  stockpileOverlay,
  treeCount,
  gridW,
  gridH,
  state,
  applyDebugVisibility,
  updateHud,
});

loop.start();
updateHud();
