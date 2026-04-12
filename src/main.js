/**
 * Phase 2 entry: tile grid + RTS camera + picker + save/load.
 *
 * The Phase 1 stress test is preserved behind ?stress=N (e.g. ?stress=1000)
 * so the ECS + sim loop wiring stays exercised end-to-end.
 */

import { registerPhase1Components } from './components/index.js';
import { Scheduler } from './ecs/schedule.js';
import { World } from './ecs/world.js';
import { TilePicker } from './render/picker.js';
import { RtsCamera } from './render/rtsCamera.js';
import { createScene } from './render/scene.js';
import { createStressInstancer } from './render/stressInstancer.js';
import { buildTileMesh } from './render/tileMesh.js';
import { SimLoop } from './sim/loop.js';
import { applyVelocity, snapshotPositions, spawnStressEntities, stressBounce } from './stress.js';
import { DEFAULT_GRID_H, DEFAULT_GRID_W } from './world/coords.js';
import {
  gunzipBytes,
  gzipString,
  hydrateTileGrid,
  loadState,
  serializeState,
} from './world/persist.js';
import { TileGrid } from './world/tileGrid.js';

const params = new URLSearchParams(location.search);
const stressCount = Number.parseInt(params.get('stress') ?? '0', 10);
const gridW = Number.parseInt(params.get('w') ?? `${DEFAULT_GRID_W}`, 10);
const gridH = Number.parseInt(params.get('h') ?? `${DEFAULT_GRID_H}`, 10);

const tileGrid = new TileGrid(gridW, gridH);
tileGrid.generateSimpleHeightmap(8);

const world = new World();
registerPhase1Components(world);

const scheduler = new Scheduler();
scheduler.add(snapshotPositions);
scheduler.add(applyVelocity);
scheduler.add(stressBounce);
if (stressCount > 0) spawnStressEntities(world, stressCount);

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
const { renderer, scene, camera } = createScene(canvas);
const tileMesh = buildTileMesh(tileGrid);
scene.add(tileMesh);
const rts = new RtsCamera(camera, canvas);

let lastPick = /** @type {{ i: number, j: number } | null} */ (null);
new TilePicker(canvas, camera, tileMesh, { W: gridW, H: gridH }, (hit) => {
  lastPick = hit;
  console.log('[pick]', hit);
});

const stressInstancer = stressCount > 0 ? createStressInstancer(scene, stressCount) : null;

const hud = /** @type {HTMLElement} */ (document.getElementById('hud'));
let renderFrameCount = 0;
let renderFpsSampleStart = performance.now();
let measuredFps = 0;
let lastRenderClock = performance.now();

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
  const pickStr = lastPick ? `pick: i=${lastPick.i} j=${lastPick.j}` : 'pick: (click a tile)';
  const lines = [
    'phase 2: world + camera + save/load',
    `grid: ${gridW}x${gridH}  tiles=${gridW * gridH}`,
    `sim: tick=${loop.tick}  Hz=${loop.measuredHz.toFixed(0)}/30  steps/frame=${loop.lastSteps}`,
    `render: ${measuredFps.toFixed(0)} fps`,
    `entities: ${world.entityCount}  stress=${stressCount}`,
    pickStr,
    '',
    'WASD/arrows = pan, RMB-drag = orbit, wheel = zoom',
    'F5 = save, F9 = load',
  ];
  hud.innerText = lines.join('\n');
}

addEventListener('keydown', async (e) => {
  if (e.code === 'F5') {
    e.preventDefault();
    const state = serializeState(tileGrid);
    const json = JSON.stringify(state);
    const gz = await gzipString(json);
    const b64 = btoa(String.fromCharCode(...gz));
    localStorage.setItem('save:v1', b64);
    console.log('[save] gzipped bytes:', gz.length, 'b64 chars:', b64.length);
  }
  if (e.code === 'F9') {
    e.preventDefault();
    const b64 = localStorage.getItem('save:v1');
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
    const fresh = buildTileMesh(tileGrid);
    tileMesh.geometry.dispose();
    tileMesh.geometry = fresh.geometry;
    console.log('[load] restored', tileGrid.W, 'x', tileGrid.H, 'tiles');
  }
});

loop.start();
updateHud();
