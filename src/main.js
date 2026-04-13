/**
 * Phase 3 entry: tile world + cows + jobs + save/load.
 *
 * Phase 1 stress test stays behind ?stress=N. Phase 3 spawns one cow by
 * default (override with ?cows=N).
 */

import { registerPhase3Components } from './components/cow.js';
import { registerPhase1Components } from './components/index.js';
import { Scheduler } from './ecs/schedule.js';
import { World } from './ecs/world.js';
import { JobBoard } from './jobs/board.js';
import { createCowInstancer } from './render/cowInstancer.js';
import { CowSelector } from './render/cowSelector.js';
import { TilePicker } from './render/picker.js';
import { RtsCamera } from './render/rtsCamera.js';
import { createScene } from './render/scene.js';
import { createStressInstancer } from './render/stressInstancer.js';
import { buildTileMesh } from './render/tileMesh.js';
import { SimLoop } from './sim/loop.js';
import { PathCache, defaultWalkable } from './sim/pathfinding.js';
import { applyVelocity, snapshotPositions, spawnStressEntities, stressBounce } from './stress.js';
import { makeCowBrainSystem, makeCowFollowPathSystem, makeHungerSystem } from './systems/cow.js';
import { DEFAULT_GRID_H, DEFAULT_GRID_W, tileToWorld } from './world/coords.js';
import {
  gunzipBytes,
  gzipString,
  hydrateCows,
  hydrateTileGrid,
  loadState,
  serializeState,
} from './world/persist.js';
import { TileGrid } from './world/tileGrid.js';

const params = new URLSearchParams(location.search);
const stressCount = Number.parseInt(params.get('stress') ?? '0', 10);
const cowCount = Number.parseInt(params.get('cows') ?? '1', 10);
const gridW = Number.parseInt(params.get('w') ?? `${DEFAULT_GRID_W}`, 10);
const gridH = Number.parseInt(params.get('h') ?? `${DEFAULT_GRID_H}`, 10);

const tileGrid = new TileGrid(gridW, gridH);
tileGrid.generateSimpleHeightmap(8);

const world = new World();
registerPhase1Components(world);
registerPhase3Components(world);

const pathCache = new PathCache(tileGrid, defaultWalkable);
const jobBoard = new JobBoard();

const scheduler = new Scheduler();
scheduler.add(snapshotPositions);
scheduler.add(makeCowBrainSystem({ grid: tileGrid, paths: pathCache, walkable: defaultWalkable }));
scheduler.add(
  makeCowFollowPathSystem({ grid: tileGrid, paths: pathCache, walkable: defaultWalkable }),
);
scheduler.add(applyVelocity);
scheduler.add(stressBounce);
scheduler.add(makeHungerSystem());

if (stressCount > 0) spawnStressEntities(world, stressCount);
spawnInitialCows(cowCount);

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
const { renderer, scene, camera } = createScene(canvas);
let tileMesh = buildTileMesh(tileGrid);
scene.add(tileMesh);
const rts = new RtsCamera(camera, canvas);
const cowInstancer = createCowInstancer(scene, 256);

let selectedCow = /** @type {number | null} */ (null);
new CowSelector(canvas, camera, cowInstancer, tileMesh, world, (id) => {
  selectedCow = id;
  updateHud();
});

let lastPick = /** @type {{ i: number, j: number } | null} */ (null);
new TilePicker(canvas, camera, tileMesh, { W: gridW, H: gridH }, (hit) => {
  lastPick = hit;
});

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
    cowInstancer.update(world, alpha, (now - startClock) / 1000);
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

let cowsSpawned = 0;

/** @param {number} i @param {number} j */
function spawnCowAt(i, j) {
  if (!tileGrid.inBounds(i, j)) return;
  const w = tileToWorld(i, j, gridW, gridH);
  const y = tileGrid.getElevation(i, j);
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
  if (selectedCow !== null) {
    const brain = world.get(selectedCow, 'Brain');
    const hunger = world.get(selectedCow, 'Hunger');
    const job = world.get(selectedCow, 'Job');
    const path = world.get(selectedCow, 'Path');
    const pos = world.get(selectedCow, 'Position');
    if (brain) {
      cowLines = [
        '',
        `selected: ${brain.name}`,
        `  pos: x=${pos.x.toFixed(1)} z=${pos.z.toFixed(1)}`,
        `  hunger: ${(hunger.value * 100).toFixed(0)}%`,
        `  job: ${job.kind} / ${job.state}`,
        `  path: ${path.index}/${path.steps.length} steps`,
      ];
    } else {
      cowLines = ['', 'selected cow despawned'];
      selectedCow = null;
    }
  }
  const pickStr = lastPick ? `pick: i=${lastPick.i} j=${lastPick.j}` : 'pick: (click a tile)';
  const lines = [
    'phase 3: cows + pathfinding + jobs',
    `grid: ${gridW}x${gridH}  tiles=${gridW * gridH}`,
    `sim: tick=${loop.tick}  Hz=${loop.measuredHz.toFixed(0)}/30  steps/frame=${loop.lastSteps}`,
    `render: ${measuredFps.toFixed(0)} fps`,
    `entities: ${world.entityCount}  cows=${countCows()}  stress=${stressCount}`,
    `paths: hits=${pathCache.hits} misses=${pathCache.misses}  jobs=${jobBoard.openCount}`,
    pickStr,
    ...cowLines,
    '',
    'WASD/arrows = pan, RMB-drag = orbit, wheel = zoom',
    'N = spawn cow at last clicked tile',
    'F5 = save, F9 = load',
  ];
  hud.innerText = lines.join('\n');
}

addEventListener('keydown', async (e) => {
  if (e.code === 'KeyN') {
    const tile = lastPick ?? { i: Math.floor(gridW / 2), j: Math.floor(gridH / 2) };
    spawnCowAt(tile.i, tile.j);
    updateHud();
    return;
  }
  if (e.code === 'F5') {
    e.preventDefault();
    const state = serializeState(tileGrid, world);
    const json = JSON.stringify(state);
    const gz = await gzipString(json);
    const b64 = btoa(String.fromCharCode(...gz));
    localStorage.setItem('save:v2', b64);
    console.log('[save] cows:', state.cows.length, 'gzipped bytes:', gz.length);
  }
  if (e.code === 'F9') {
    e.preventDefault();
    const b64 = localStorage.getItem('save:v2') ?? localStorage.getItem('save:v1');
    if (!b64) {
      console.warn('[load] no save in localStorage');
      return;
    }
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const json = await gunzipBytes(bin);
    const parsed = JSON.parse(json);
    const migrated = loadState(parsed);
    const loaded = hydrateTileGrid(migrated);
    tileGrid.elevation.set(loaded.elevation);
    tileGrid.biome.set(loaded.biome);
    pathCache.clear();
    despawnAllCows(world);
    hydrateCows(world, migrated);
    const fresh = buildTileMesh(tileGrid);
    scene.remove(tileMesh);
    tileMesh.geometry.dispose();
    tileMesh = fresh;
    scene.add(tileMesh);
    selectedCow = null;
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

/** @param {import('./ecs/world.js').World} w */
function despawnAllCows(w) {
  const ids = [];
  for (const { id } of w.query(['Cow'])) ids.push(id);
  for (const id of ids) w.despawn(id);
}

loop.start();
updateHud();
