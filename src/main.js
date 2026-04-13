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
import { ChopDesignator } from './render/chopDesignator.js';
import { createCowInstancer } from './render/cowInstancer.js';
import { createCowNameTags } from './render/cowNameTags.js';
import { CowSelector } from './render/cowSelector.js';
import { createItemInstancer } from './render/itemInstancer.js';
import { CowMoveCommand } from './render/moveCommand.js';
import { TilePicker } from './render/picker.js';
import { RtsCamera } from './render/rtsCamera.js';
import { createScene } from './render/scene.js';
import { SelectionBox } from './render/selectionBox.js';
import { createSelectionViz } from './render/selectionViz.js';
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
import {
  gunzipBytes,
  gzipString,
  hydrateCows,
  hydrateTileGrid,
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
const cowCount = Number.parseInt(params.get('cows') ?? '1', 10);
const treeCount = Number.parseInt(params.get('trees') ?? '60', 10);
const gridW = Number.parseInt(params.get('w') ?? `${DEFAULT_GRID_W}`, 10);
const gridH = Number.parseInt(params.get('h') ?? `${DEFAULT_GRID_H}`, 10);

const tileGrid = new TileGrid(gridW, gridH);
tileGrid.generateSimpleHeightmap(8);

const world = new World();
registerComponents(world);

const pathCache = new PathCache(tileGrid, defaultWalkable);
const jobBoard = new JobBoard();

// Forward-declared so the brain's onChopComplete can poke the renderers once
// they're constructed below.
let onWorldChopComplete = () => {};

const scheduler = new Scheduler();
scheduler.add(snapshotPositions);
scheduler.add(
  makeCowBrainSystem({
    grid: tileGrid,
    paths: pathCache,
    walkable: defaultWalkable,
    board: jobBoard,
    onChopComplete: () => onWorldChopComplete(),
  }),
);
scheduler.add(
  makeCowFollowPathSystem({ grid: tileGrid, paths: pathCache, walkable: defaultWalkable }),
);
scheduler.add(applyVelocity);
scheduler.add(stressBounce);
scheduler.add(makeHungerSystem());

let cowsSpawned = 0;

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

onWorldChopComplete = () => {
  treeInstancer.markDirty();
  itemInstancer.markDirty();
  pathCache.clear();
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

const chopDesignator = new ChopDesignator(canvas, camera, treeInstancer, world, jobBoard, () =>
  updateHud(),
);

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
    rts.update(rdt);
    if (stressInstancer) stressInstancer.update(world, alpha);
    const tSec = (now - startClock) / 1000;
    cowInstancer.update(world, alpha, tSec, tileGrid);
    cowNameTags.update(world, camera, alpha);
    treeInstancer.update(world, tileGrid);
    treeInstancer.updateMarkers(world, tileGrid, tSec);
    itemInstancer.update(world, tileGrid);
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
  cowsSpawned += 1;
  world.spawn({
    Cow: {},
    Position: { x: w.x, y, z: w.z },
    PrevPosition: { x: w.x, y, z: w.z },
    Velocity: { x: 0, y: 0, z: 0 },
    Hunger: { value: 1 },
    Brain: { name: `cow#${cowsSpawned}` },
    Job: { kind: 'none', state: 'idle', payload: {} },
    Path: { steps: [], index: 0 },
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

/** @param {number} count */
function spawnInitialCows(count) {
  for (let n = 0; n < count; n++) {
    const i = Math.floor(gridW / 2 + (Math.random() * 6 - 3));
    const j = Math.floor(gridH / 2 + (Math.random() * 6 - 3));
    spawnCowAt(i, j);
  }
}

function updateHud() {
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
    'phase 4: trees + chop',
    `grid: ${gridW}x${gridH}  tiles=${gridW * gridH}`,
    `sim: tick=${loop.tick}  Hz=${loop.measuredHz.toFixed(0)}/30  steps/frame=${loop.lastSteps}`,
    `render: ${measuredFps.toFixed(0)} fps`,
    `entities: ${world.entityCount}  cows=${countCows()}  trees=${countComp('Tree')}  wood=${countComp('Item')}`,
    `paths: hits=${pathCache.hits} misses=${pathCache.misses}  jobs=${jobBoard.openCount}`,
    pickStr,
    ...cowLines,
    '',
  ];
  if (chopDesignator.active) {
    lines.push('** CHOP DESIGNATE — click trees to mark, C or Esc to exit **');
  }
  lines.push(
    'WASD/arrows = pan (hold Shift = 2x), MMB-drag = orbit, wheel = zoom',
    'LMB = select, Shift+LMB = add/toggle, RMB = move-to, Shift+RMB = queue',
    'C = chop designate mode,  N = spawn cow at last clicked tile',
    'K = save, L = load',
  );
  hud.innerText = lines.join('\n');
}

addEventListener('keydown', async (e) => {
  if (e.code === 'KeyN') {
    const tile = lastPick ?? { i: Math.floor(gridW / 2), j: Math.floor(gridH / 2) };
    spawnCowAt(tile.i, tile.j);
    updateHud();
    return;
  }
  if (e.code === 'KeyK') {
    try {
      const state = serializeState(tileGrid, world);
      const json = JSON.stringify(state);
      const gz = await gzipString(json);
      const b64 = bytesToBase64(gz);
      localStorage.setItem('save:v3', b64);
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
    const b64 = localStorage.getItem('save:v3') ?? localStorage.getItem('save:v2');
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
    tileGrid.occupancy.fill(0);
    pathCache.clear();
    despawnAllCows(world);
    despawnAllComp(world, 'Tree');
    despawnAllComp(world, 'Item');
    // Trees aren't persisted in slice A — regenerate a fresh scatter on load
    // so the world doesn't end up bare.
    spawnInitialTrees(world, tileGrid, treeCount);
    treeInstancer.markDirty();
    itemInstancer.markDirty();
    hydrateCows(world, migrated);
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
  }
});

function countCows() {
  let n = 0;
  for (const _ of world.query(['Cow'])) n++;
  return n;
}

/** @param {string} component */
function countComp(component) {
  let n = 0;
  for (const _ of world.query([component])) n++;
  return n;
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

/** @param {import('./ecs/world.js').World} w */
function despawnAllCows(w) {
  const ids = [];
  for (const { id } of w.query(['Cow'])) ids.push(id);
  for (const id of ids) w.despawn(id);
}

/** @param {import('./ecs/world.js').World} w @param {string} comp */
function despawnAllComp(w, comp) {
  const ids = [];
  for (const { id } of w.query([comp])) ids.push(id);
  for (const id of ids) w.despawn(id);
}

loop.start();
updateHud();
