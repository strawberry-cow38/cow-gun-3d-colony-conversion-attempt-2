/**
 * Main entry: tile world + cows + jobs + save/load.
 *
 * Stress test stays behind ?stress=N; cow count overridable via ?cows=N
 * (default 10).
 */

import { createAudio } from './audio/audio.js';
import { createHud } from './boot/hud.js';
import { installKeyboard } from './boot/input.js';
import { readBootParams } from './boot/params.js';
import { spawnInitialCows } from './boot/spawn.js';
import { registerComponents } from './components/index.js';
import { Scheduler } from './ecs/schedule.js';
import { World } from './ecs/world.js';
import { JobBoard } from './jobs/board.js';
import { makeHaulPostingSystem } from './jobs/haul.js';
import {
  BuildDesignator,
  DOOR_DESIGNATOR_CONFIG,
  ROOF_DESIGNATOR_CONFIG,
  TORCH_DESIGNATOR_CONFIG,
  WALL_DESIGNATOR_CONFIG,
} from './render/buildDesignator.js';
import { createBuildSiteInstancer } from './render/buildSiteInstancer.js';
import { createBuildTab } from './render/buildTab.js';
import { CancelDesignator } from './render/cancelDesignator.js';
import { ChopDesignator } from './render/chopDesignator.js';
import { createCowCamOverlay } from './render/cowCamOverlay.js';
import { createCowInstancer } from './render/cowInstancer.js';
import { createCowNameTags } from './render/cowNameTags.js';
import { createCowPortraitBar } from './render/cowPortraitBar.js';
import { CowSelector } from './render/cowSelector.js';
import { createCowThoughtBubbles } from './render/cowThoughtBubbles.js';
import { DeconstructDesignator } from './render/deconstructDesignator.js';
import { createDeconstructOverlay } from './render/deconstructOverlay.js';
import { createDoorInstancer } from './render/doorInstancer.js';
import { createDraftBadge } from './render/draftBadge.js';
import { FirstPersonCamera } from './render/firstPersonCamera.js';
import { IgnoreRoofDesignator } from './render/ignoreRoofDesignator.js';
import { createIgnoreRoofOverlay } from './render/ignoreRoofOverlay.js';
import { createItemInstancer } from './render/itemInstancer.js';
import { createItemLabels } from './render/itemLabels.js';
import { CowMoveCommand } from './render/moveCommand.js';
import { createPickTileOverlay } from './render/pickTileOverlay.js';
import { TilePicker } from './render/picker.js';
import { createRoofInstancer } from './render/roofInstancer.js';
import { createRoomOverlay } from './render/roomOverlay.js';
import { RtsCamera } from './render/rtsCamera.js';
import { createScene } from './render/scene.js';
import { SelectionBox } from './render/selectionBox.js';
import { createSelectionViz } from './render/selectionViz.js';
import { StockpileDesignator } from './render/stockpileDesignator.js';
import { createStockpileOverlay } from './render/stockpileOverlay.js';
import { createStressInstancer } from './render/stressInstancer.js';
import { buildTileMesh } from './render/tileMesh.js';
import { createTorchInstancer } from './render/torchInstancer.js';
import { createTreeInstancer } from './render/treeInstancer.js';
import { createWallInstancer } from './render/wallInstancer.js';
import { SimLoop } from './sim/loop.js';
import { PathCache, defaultWalkable } from './sim/pathfinding.js';
import { spawnStressEntities, stressBounce } from './stress.js';
import { runAutoRoof } from './systems/autoRoof.js';
import {
  makeCowBrainSystem,
  makeCowFollowPathSystem,
  makeCowWallCollisionSystem,
  makeHungerSystem,
} from './systems/cow.js';
import { makeLightingSystem } from './systems/lighting.js';
import { applyVelocity, snapshotPositions } from './systems/movement.js';
import { createRooms, makeRoomsSystem } from './systems/rooms.js';
import { spawnInitialTrees } from './systems/trees.js';
import { TILE_SIZE } from './world/coords.js';
import { TileGrid } from './world/tileGrid.js';
import { createTimeOfDay } from './world/timeOfDay.js';
import { createWeather } from './world/weather.js';

const { stressCount, cowCount, treeCount, gridW, gridH } = readBootParams();

const tileGrid = new TileGrid(gridW, gridH);
tileGrid.generateTerrain();

const world = new World();
registerComponents(world);

const pathCache = new PathCache(tileGrid, defaultWalkable);
const jobBoard = new JobBoard();
const rooms = createRooms(tileGrid);

// Forward-declared so the brain can poke the renderers + audio engine once
// they're constructed below. Callbacks receive the emitter's world position
// so the directional audio layer can pan the sound correctly; the renderer
// wrappers ignore the arg.
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldChopComplete = () => {};
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldCowEat = () => {};
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldCowStep = () => {};
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldCowHammer = () => {};
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldBuildComplete = () => {};
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
    onChopComplete: (pos) => onWorldChopComplete(pos),
    onCowEat: (pos) => onWorldCowEat(pos),
    onCowHammer: (pos) => onWorldCowHammer(pos),
    onBuildComplete: (pos) => onWorldBuildComplete(pos),
    onItemChange: () => onWorldItemChange(),
  }),
);
scheduler.add(
  makeCowFollowPathSystem({
    grid: tileGrid,
    paths: pathCache,
    walkable: defaultWalkable,
    drivingCowId: () => getDrivingCowId(),
    onCowStep: (pos) => onWorldCowStep(pos),
  }),
);
scheduler.add(applyVelocity);
scheduler.add(makeCowWallCollisionSystem(tileGrid));
if (stressCount > 0) scheduler.add(stressBounce);
scheduler.add(makeHungerSystem());
scheduler.add(makeHaulPostingSystem(jobBoard, tileGrid));
// Forward-declared so the rooms system can poke the overlay's dirty flag
// once the renderer (constructed below) is in scope.
let onRoomsRebuilt = () => {};
scheduler.add(makeRoomsSystem({ rooms, onRebuilt: () => onRoomsRebuilt() }));

if (stressCount > 0) spawnStressEntities(world, stressCount);
spawnInitialTrees(world, tileGrid, treeCount);
spawnInitialCows(world, tileGrid, cowCount);

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
const { renderer, scene, camera, sun, hemi, sky } = createScene(canvas);
const audio = createAudio({ camera });
const timeOfDay = createTimeOfDay({ sun, hemi, sky });
const weather = createWeather({ scene, timeOfDay, sun, hemi, audio });
const lightingSystem = makeLightingSystem({ grid: tileGrid, timeOfDay });
scheduler.add(lightingSystem);
// Seed the tile light grid so tick 0 already sees valid values — the cow
// follow-path system reads it to apply the darkness slowdown.
lightingSystem.run(world, { tick: 0, dt: 0, dirty: scheduler.dirty });
const rts = new RtsCamera(camera, canvas);
// Keep the orbit focus pinned to the playable grid — beyond these the camera
// just stares at empty void, and follow/dbl-click-focus could otherwise push
// it past the edge on small maps.
const halfGridX = (gridW * TILE_SIZE) / 2;
const halfGridZ = (gridH * TILE_SIZE) / 2;
rts.minX = -halfGridX;
rts.maxX = halfGridX;
rts.minZ = -halfGridZ;
rts.maxZ = halfGridZ;
const cowInstancer = createCowInstancer(scene, 256);
const cowNameTags = createCowNameTags(scene);
const cowThoughtBubbles = createCowThoughtBubbles(scene);
const selectionViz = createSelectionViz(scene);
const treeInstancer = createTreeInstancer(scene, 2048);
const wallInstancer = createWallInstancer(scene, 2048);
const doorInstancer = createDoorInstancer(scene, 512, audio);
const torchInstancer = createTorchInstancer(scene, 512);
const roofInstancer = createRoofInstancer(scene, gridW * gridH);
const buildSiteInstancer = createBuildSiteInstancer(scene, 1024);
const itemInstancer = createItemInstancer(scene, 1024);
const itemLabels = createItemLabels(scene);
const stockpileOverlay = createStockpileOverlay(scene, gridW * gridH);
const roomOverlay = createRoomOverlay(scene, gridW * gridH);
const ignoreRoofOverlay = createIgnoreRoofOverlay(scene, gridW * gridH);
const deconstructOverlay = createDeconstructOverlay(scene, gridW * gridH);
const pickTileOverlay = createPickTileOverlay(scene);

onWorldChopComplete = (pos) => {
  treeInstancer.markDirty();
  itemInstancer.markDirty();
  pathCache.clear();
  audio.playAt('chop', pos);
};
onWorldCowEat = (pos) => {
  audio.playAt('munch', pos);
};
onWorldCowStep = (pos) => {
  audio.playAt('footfall', pos);
};
onWorldCowHammer = (pos) => {
  audio.playAt('hammer', pos);
};
onWorldBuildComplete = (pos) => {
  wallInstancer.markDirty();
  roofInstancer.markDirty();
  buildSiteInstancer.markDirty();
  deconstructOverlay.markDirty();
  pathCache.clear();
  // Walls/doors can open or close a room, so ask the rooms system to redo
  // its flood-fill on the next tick. Torches don't affect topology but
  // onBuildComplete is reused for deconstruct too, and the false positives
  // are cheap compared to tracking the kind here.
  scheduler.dirty.mark('topology');
  audio.playAt('hammer', pos);
};
onRoomsRebuilt = () => {
  roomOverlay.markDirty();
  // Auto-queue roofs for newly enclosed rooms. Runs in the same tick as the
  // flood-fill so the next rare haul-poster tick sees the fresh BuildSites.
  runAutoRoof(world, tileGrid, jobBoard, rooms);
  buildSiteInstancer.markDirty();
};
onWorldItemChange = () => {
  itemInstancer.markDirty();
  buildSiteInstancer.markDirty();
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

// hudApi is populated below once all the refs (designators, fpCamera) exist,
// but selection callbacks, designator callbacks, and the render loop all
// reference updateHud/pruneStaleSelections during construction. Bouncing
// through wrappers keeps the declaration order simple.
/** @type {import('./boot/hud.js').HudApi | null} */
let hudApi = null;
const updateHud = () => hudApi?.updateHud();
const pruneStaleSelections = () => hudApi?.pruneStaleSelections();

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
  if (ids.length > 0) audio.play('command');
  updateHud();
});

/**
 * Shared selection callback — same code path for canvas clicks (CowSelector)
 * and portrait-bar clicks. `id === null` is "clicked empty space".
 *
 * @param {number | null} id
 * @param {boolean} additive
 */
const selectCow = (id, additive) => {
  if (id === null) {
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
    audio.play('click');
  } else {
    state.selectedCows.clear();
    state.selectedCows.add(id);
    state.primaryCow = id;
    audio.play('click');
  }
  updateHud();
};

new CowSelector(canvas, camera, cowInstancer, () => state.tileMesh, world, selectCow);

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
  audio,
);

/**
 * The designators are mutually exclusive — activating one deactivates every
 * other. Each one's onStateChanged just walks this list. The array is built
 * up as constructors run; that forward-declared `null` slot is fine because
 * onStateChanged only fires from event handlers that can't run before the
 * whole list has been populated.
 * @type {{ active: boolean, deactivate: () => void }[]}
 */
const designators = [];
/** @param {{ active: boolean, deactivate: () => void }} self */
const deactivateOthers = (self) => {
  if (!self.active) return;
  for (const d of designators) if (d !== self) d.deactivate();
};

const chopDesignator = new ChopDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  treeInstancer,
  world,
  jobBoard,
  scene,
  () => {
    deactivateOthers(chopDesignator);
    updateHud();
  },
  audio,
);
designators.push(chopDesignator);

const stockpileDesignator = new StockpileDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  stockpileOverlay,
  scene,
  () => {
    deactivateOthers(stockpileDesignator);
    updateHud();
  },
  audio,
);
designators.push(stockpileDesignator);

const wallDesignator = new BuildDesignator(
  WALL_DESIGNATOR_CONFIG,
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  buildSiteInstancer,
  scene,
  () => {
    deactivateOthers(wallDesignator);
    updateHud();
  },
  audio,
);
designators.push(wallDesignator);

const doorDesignator = new BuildDesignator(
  DOOR_DESIGNATOR_CONFIG,
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  buildSiteInstancer,
  scene,
  () => {
    deactivateOthers(doorDesignator);
    updateHud();
  },
  audio,
  deconstructOverlay,
);
designators.push(doorDesignator);

const torchDesignator = new BuildDesignator(
  TORCH_DESIGNATOR_CONFIG,
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  buildSiteInstancer,
  scene,
  () => {
    deactivateOthers(torchDesignator);
    updateHud();
  },
  audio,
);
designators.push(torchDesignator);

const roofDesignator = new BuildDesignator(
  ROOF_DESIGNATOR_CONFIG,
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  buildSiteInstancer,
  scene,
  () => {
    deactivateOthers(roofDesignator);
    updateHud();
  },
  audio,
);
designators.push(roofDesignator);

const ignoreRoofDesignator = new IgnoreRoofDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  ignoreRoofOverlay,
  scene,
  () => {
    deactivateOthers(ignoreRoofDesignator);
    updateHud();
  },
  audio,
);
designators.push(ignoreRoofDesignator);

const deconstructDesignator = new DeconstructDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  [wallInstancer, roofInstancer, deconstructOverlay],
  scene,
  () => {
    deactivateOthers(deconstructDesignator);
    updateHud();
  },
  audio,
);
designators.push(deconstructDesignator);

const cancelDesignator = new CancelDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  buildSiteInstancer,
  [wallInstancer, roofInstancer, deconstructOverlay],
  scene,
  () => {
    deactivateOthers(cancelDesignator);
    updateHud();
  },
  audio,
);
designators.push(cancelDesignator);

const fpCamera = new FirstPersonCamera(camera, canvas, world, () => updateHud());
getDrivingCowId = () => fpCamera.drivingCowId;
const cowCamOverlay = createCowCamOverlay();
const draftBadge = createDraftBadge(scene, 256);

const buildTab = createBuildTab({
  chopDesignator,
  stockpileDesignator,
  wallDesignator,
  doorDesignator,
  torchDesignator,
  roofDesignator,
  ignoreRoofDesignator,
  deconstructDesignator,
  cancelDesignator,
});

const cowPortraitBar = createCowPortraitBar({
  world,
  state,
  fpCamera,
  onSelect: selectCow,
  onFocus: (id) => {
    // Snap rts.focus straight to the cow so the camera doesn't have to ease
    // across the map first — follow mode then keeps it locked on.
    const pos = world.get(id, 'Position');
    if (pos) rts.focus.set(pos.x, pos.y, pos.z);
    state.selectedCows.add(id);
    state.primaryCow = id;
    state.followEnabled = true;
    audio.play('click');
    updateHud();
  },
});

const stressInstancer = stressCount > 0 ? createStressInstancer(scene, stressCount) : null;

const hud = /** @type {HTMLElement} */ (document.getElementById('hud'));
const clockEl = /** @type {HTMLElement} */ (document.getElementById('clock'));

/** @param {number} speed */
function speedIcon(speed) {
  if (speed === 0) return '⏸';
  // 6x reads as "▶▶▶▶" — same arrow alphabet as 1/2/3x so the player
  // doesn't read it as a distinct "turbo" tier, just "more arrows = faster".
  if (speed === 6) return '▶▶▶▶';
  return '▶'.repeat(speed);
}

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
    audio.update();
    timeOfDay.update(rdt);
    weather.update(rdt, camera.position);
    cowCamOverlay.update(fpCamera, world);
    if (stressInstancer) stressInstancer.update(world, alpha);
    const tSec = (now - startClock) / 1000;
    const hiddenCowId = fpCamera.active ? fpCamera.cowId : null;
    cowInstancer.update(world, alpha, tSec, tileGrid, hiddenCowId);
    cowNameTags.update(world, camera, alpha);
    cowThoughtBubbles.update(world, camera, alpha);
    draftBadge.update(world, tSec);
    treeInstancer.update(world, tileGrid);
    treeInstancer.updateMarkers(world, tileGrid, tSec);
    wallInstancer.update(world, tileGrid);
    doorInstancer.update(world, tileGrid);
    torchInstancer.update(world, tileGrid, tSec, camera);
    roofInstancer.update(world, tileGrid);
    buildSiteInstancer.update(world, tileGrid);
    itemInstancer.update(world, tileGrid);
    itemLabels.update(world, camera, tileGrid);
    stockpileOverlay.update(tileGrid);
    roomOverlay.update(tileGrid, rooms);
    ignoreRoofOverlay.update(tileGrid);
    deconstructOverlay.update(world, tileGrid);
    pickTileOverlay.update(tileGrid, state.lastPick);
    pruneStaleSelections();
    cowPortraitBar.update();
    buildTab.update();
    selectionViz.update(world, state.selectedCows, alpha, tSec, tileGrid);
    clockEl.textContent = `${timeOfDay.getHHMM()} ${speedIcon(loop.speed)}`;
    // Anchor the sky sphere to the camera so no amount of zoom-out or pan
    // can put the camera outside the sky — the purple scene.background stays
    // hidden regardless of camera distance from the world origin.
    sky.position.copy(camera.position);
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

hudApi = createHud({
  hud,
  world,
  tileGrid,
  pathCache,
  jobBoard,
  gridW,
  gridH,
  loop,
  state,
  fpCamera,
  chopDesignator,
  stockpileDesignator,
  cowNameTags,
  cowThoughtBubbles,
  itemLabels,
  stockpileOverlay,
  roomOverlay,
  ignoreRoofOverlay,
  roofInstancer,
  pickTileOverlay,
  rooms,
  timeOfDay,
  weather,
  getFps: () => measuredFps,
});

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
  rooms,
  roomOverlay,
  ignoreRoofOverlay,
  roofInstancer,
  buildSiteInstancer,
  wallInstancer,
  treeCount,
  gridW,
  gridH,
  state,
  audio,
  timeOfDay,
  weather,
  loop,
  applyDebugVisibility: hudApi.applyDebugVisibility,
  updateHud: hudApi.updateHud,
});

loop.start();
hudApi.updateHud();
