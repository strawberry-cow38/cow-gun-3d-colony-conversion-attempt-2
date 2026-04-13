/**
 * Phase 3 entry: tile world + cows + jobs + save/load.
 *
 * Phase 1 stress test stays behind ?stress=N. Phase 3 spawns one cow by
 * default (override with ?cows=N).
 */

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
import { DEFAULT_GRID_H, DEFAULT_GRID_W, tileToWorld } from './world/coords.js';
import { pickCowName } from './world/cowNames.js';
import { ITEM_KINDS, maxStack } from './world/items.js';
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

/**
 * Chunked base64 of a byte array. `btoa(String.fromCharCode(...bytes))` throws
 * `Maximum call stack size exceeded` once `bytes` grows past ~100k because
 * spread passes every element as a separate argument. Chunked path is safe
 * for arbitrarily large buffers.
 * @param {Uint8Array} bytes
 */
function bytesToBase64(bytes) {
  const chunk = 0x8000;
  let str = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + chunk)));
  }
  return btoa(str);
}

/** @param {string} b64 */
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const params = new URLSearchParams(location.search);
const stressCount = Number.parseInt(params.get('stress') ?? '0', 10);
const cowCount = Number.parseInt(params.get('cows') ?? '10', 10);
const treeCount = Number.parseInt(params.get('trees') ?? '60', 10);
const gridW = Number.parseInt(params.get('w') ?? `${DEFAULT_GRID_W}`, 10);
const gridH = Number.parseInt(params.get('h') ?? `${DEFAULT_GRID_H}`, 10);

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
scheduler.add(stressBounce);
scheduler.add(makeHungerSystem());
scheduler.add(makeHaulPostingSystem(jobBoard, tileGrid));

if (stressCount > 0) spawnStressEntities(world, stressCount);
spawnInitialTrees(world, tileGrid, treeCount);
spawnInitialCows(cowCount);

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

new CowSelector(canvas, camera, cowInstancer, tileMesh, world, (id, additive) => {
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
          selectedCows.size > 0 ? /** @type {number} */ (selectedCows.values().next().value) : null;
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
});

let lastPick = /** @type {{ i: number, j: number } | null} */ (null);
new TilePicker(canvas, camera, tileMesh, { W: gridW, H: gridH }, (hit) => {
  lastPick = hit;
});

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

/** @param {number} i @param {number} j */
function spawnCowAt(i, j) {
  if (!tileGrid.inBounds(i, j)) return;
  const placed = nearestFreeTile(i, j);
  if (!placed) return;
  const w = tileToWorld(placed.i, placed.j, gridW, gridH);
  const y = tileGrid.getElevation(placed.i, placed.j);
  world.spawn({
    Cow: { drafted: false },
    Position: { x: w.x, y, z: w.z },
    PrevPosition: { x: w.x, y, z: w.z },
    Velocity: { x: 0, y: 0, z: 0 },
    Hunger: { value: 1 },
    Brain: { name: pickCowName() },
    Job: { kind: 'none', state: 'idle', payload: {} },
    Path: { steps: [], index: 0 },
    Inventory: { itemKind: null },
    CowViz: {},
  });
}

/**
 * BFS outward from (i,j) to the nearest non-blocked in-bounds tile. Used so
 * cow spawn never lands on a tree/rock. Returns null only if the whole grid
 * is blocked, which shouldn't happen.
 * @param {number} i @param {number} j
 */
function nearestFreeTile(i, j) {
  const seen = new Uint8Array(gridW * gridH);
  const queue = [{ i, j }];
  seen[j * gridW + i] = 1;
  let head = 0;
  while (head < queue.length) {
    const t = queue[head++];
    if (tileGrid.inBounds(t.i, t.j) && !tileGrid.isBlocked(t.i, t.j)) return t;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = t.i + di;
      const nj = t.j + dj;
      if (ni < 0 || nj < 0 || ni >= gridW || nj >= gridH) continue;
      const idx = nj * gridW + ni;
      if (seen[idx]) continue;
      seen[idx] = 1;
      queue.push({ i: ni, j: nj });
    }
  }
  return null;
}

/**
 * Drop one unit of `kind` at (i, j), merging into an existing same-kind stack
 * if one is already there. Used by the G/F debug keys.
 * @param {number} i @param {number} j @param {string} kind
 */
function spawnItemAt(i, j, kind) {
  if (!tileGrid.inBounds(i, j)) return;
  const cap = maxStack(kind);
  for (const { components } of world.query(['Item', 'TileAnchor'])) {
    const a = components.TileAnchor;
    const it = components.Item;
    if (a.i === i && a.j === j && it.kind === kind && it.count < cap) {
      it.count += 1;
      return;
    }
  }
  const w = tileToWorld(i, j, gridW, gridH);
  world.spawn({
    Item: { kind, count: 1, capacity: cap },
    ItemViz: {},
    TileAnchor: { i, j },
    Position: { x: w.x, y: tileGrid.getElevation(i, j), z: w.z },
  });
}

/**
 * Flip the `drafted` flag on each cow. Mixed selections all go to "drafted"
 * (so one press never silently drafts half the crowd and un-drafts the rest);
 * if everyone is already drafted, the press releases them.
 *
 * Cows transitioning INTO drafted stop immediately — path cleared, velocity
 * zeroed, job reset. Any jobs they'd claimed (chop/haul/eat) get released
 * back to the board via the brain on its next tick.
 * @param {number[]} cowIds
 */
function toggleDraft(cowIds) {
  const ids = [];
  for (const id of cowIds) {
    if (world.get(id, 'Cow')) ids.push(id);
  }
  if (ids.length === 0) return;
  const allDrafted = ids.every((id) => world.get(id, 'Cow')?.drafted === true);
  const target = !allDrafted;
  for (const id of ids) {
    const c = world.get(id, 'Cow');
    if (!c) continue;
    const becomingDrafted = target === true && c.drafted !== true;
    c.drafted = target;
    // Either direction wakes the brain so it notices the flip next tick —
    // drafted-becoming runs the cleanup branch, released cows re-evaluate.
    const brain = world.get(id, 'Brain');
    if (brain) brain.jobDirty = true;
    if (becomingDrafted) {
      // Stop visually this frame: clear the path so cowFollowPath can't give
      // them fresh velocity, and zero the current velocity so the next
      // applyVelocity step doesn't carry them forward. Job cleanup (releasing
      // chop/haul claims, dropping carried items) happens in the brain's
      // drafted branch on the next tick using the existing code path.
      const path = world.get(id, 'Path');
      const vel = world.get(id, 'Velocity');
      if (path) {
        path.steps = [];
        path.index = 0;
      }
      if (vel) {
        vel.x = 0;
        vel.z = 0;
      }
    }
  }
}

/** @param {number} count */
function spawnInitialCows(count) {
  for (let n = 0; n < count; n++) {
    const i = Math.floor(gridW / 2 + (Math.random() * 6 - 3));
    const j = Math.floor(gridH / 2 + (Math.random() * 6 - 3));
    spawnCowAt(i, j);
  }
}

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
    `entities: ${world.entityCount}  cows=${countComp('Cow')}  trees=${countComp('Tree')}  ${itemCountsStr()}`,
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
  const draftedCount = countDrafted();
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
        const first = allCowIds()[0] ?? null;
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
    const cows = allCowIds();
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
      toggleDraft([fpCamera.cowId]);
      updateHud();
      return;
    }
    if (selectedCows.size > 0) {
      toggleDraft([...selectedCows]);
      updateHud();
      return;
    }
    return;
  }
  if (!debugEnabled) return;
  if (e.code === 'KeyN') {
    const tile = lastPick ?? { i: Math.floor(gridW / 2), j: Math.floor(gridH / 2) };
    spawnCowAt(tile.i, tile.j);
    updateHud();
    return;
  }
  if (e.code === 'KeyG' || e.code === 'KeyJ') {
    const tile = lastPick ?? { i: Math.floor(gridW / 2), j: Math.floor(gridH / 2) };
    const kind = e.code === 'KeyG' ? 'stone' : 'food';
    spawnItemAt(tile.i, tile.j, kind);
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
      localStorage.setItem('save:v7', b64);
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
      const b64 =
        localStorage.getItem('save:v7') ??
        localStorage.getItem('save:v6') ??
        localStorage.getItem('save:v5') ??
        localStorage.getItem('save:v4') ??
        localStorage.getItem('save:v3') ??
        localStorage.getItem('save:v2');
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

/** @param {string} component */
function countComp(component) {
  let n = 0;
  for (const _ of world.query([component])) n++;
  return n;
}

/** @returns {number[]} every cow id in spawn order (what query returns) */
function allCowIds() {
  const ids = [];
  for (const { id } of world.query(['Cow', 'Position'])) ids.push(id);
  return ids;
}

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

function countDrafted() {
  let n = 0;
  for (const { components } of world.query(['Cow'])) {
    if (components.Cow.drafted) n++;
  }
  return n;
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

/** @param {import('./ecs/world.js').World} w @param {string} comp */
function despawnAllComp(w, comp) {
  const ids = [];
  for (const { id } of w.query([comp])) ids.push(id);
  for (const id of ids) w.despawn(id);
}

loop.start();
updateHud();
