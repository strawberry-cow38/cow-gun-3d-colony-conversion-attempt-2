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
import { createRenderFrame } from './boot/renderFrame.js';
import { setupDesignators } from './boot/setupDesignators.js';
import { setupInstancers } from './boot/setupInstancers.js';
import { setupWorldCallbacks } from './boot/setupWorldCallbacks.js';
import { spawnInitialCows } from './boot/spawn.js';
import { registerComponents } from './components/index.js';
import { Scheduler } from './ecs/schedule.js';
import { World } from './ecs/world.js';
import { JobBoard } from './jobs/board.js';
import { makeHaulPostingSystem } from './jobs/haul.js';
import { createBuildTab } from './render/buildTab.js';
import { createCowCamOverlay } from './render/cowCamOverlay.js';
import { createCowPortraitBar } from './render/cowPortraitBar.js';
import { CowSelector } from './render/cowSelector.js';
import { createDraftBadge } from './render/draftBadge.js';
import { FirstPersonCamera } from './render/firstPersonCamera.js';
import { createEaselPanel, createFurnacePanel } from './render/furnacePanel.js';
import { StationSelector } from './render/stationSelector.js';
import { ItemSelector } from './render/itemSelector.js';
import { createItemStackPanel } from './render/itemStackPanel.js';
import { CowMoveCommand } from './render/moveCommand.js';
import { TilePicker } from './render/picker.js';
import { createPrioritizeMenu } from './render/prioritizeMenu.js';
import { RtsCamera } from './render/rtsCamera.js';
import { createScene } from './render/scene.js';
import { SelectionBox } from './render/selectionBox.js';
import { createStressInstancer } from './render/stressInstancer.js';
import { buildTileMesh } from './render/tileMesh.js';
import { SimLoop } from './sim/loop.js';
import { PathCache, defaultWalkable } from './sim/pathfinding.js';
import { spawnStressEntities, stressBounce } from './stress.js';
import { spawnInitialBoulders } from './systems/boulders.js';
import {
  makeCowBrainSystem,
  makeCowFollowPathSystem,
  makeCowWallCollisionSystem,
  makeHungerSystem,
} from './systems/cow.js';
import { makeEaselSystem } from './systems/easel.js';
import { makeFarmPostingSystem } from './systems/farm.js';
import { makeFurnaceSystem } from './systems/furnace.js';
import { makeFurnaceExpelSystem } from './systems/furnaceExpel.js';
import { makeGrowthSystem } from './systems/growth.js';
import { makeItemRescueSystem } from './systems/itemRescue.js';
import { makeLightingSystem } from './systems/lighting.js';
import { applyVelocity, snapshotPositions } from './systems/movement.js';
import { createRooms, makeRoomsSystem } from './systems/rooms.js';
import {
  makeSaplingSpawnSystem,
  makeTreeGrowthSystem,
  spawnInitialTrees,
} from './systems/trees.js';
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
let onWorldMineComplete = () => {};
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldCowEat = () => {};
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldCowStep = () => {};
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldCowHammer = () => {};
/** @type {(pos: {x:number,y:number,z:number}, kind: string) => void} */
let onWorldBuildComplete = () => {};
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldTillComplete = () => {};
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldPlantComplete = () => {};
/** @type {(pos: {x:number,y:number,z:number}) => void} */
let onWorldHarvestComplete = () => {};
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
    onMineComplete: (pos) => onWorldMineComplete(pos),
    onCowEat: (pos) => onWorldCowEat(pos),
    onCowHammer: (pos) => onWorldCowHammer(pos),
    onBuildComplete: (pos, kind) => onWorldBuildComplete(pos, kind),
    onTillComplete: (pos) => onWorldTillComplete(pos),
    onPlantComplete: (pos) => onWorldPlantComplete(pos),
    onHarvestComplete: (pos) => onWorldHarvestComplete(pos),
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
scheduler.add(makeFarmPostingSystem(jobBoard, tileGrid, world));
scheduler.add(
  makeFurnaceSystem(jobBoard, tileGrid, {
    // Forward-decl safe: furnaceInstancer + onWorldItemChange exist by the
    // time the first tick fires.
    onCraftChange: () => {
      furnaceInstancer.markDirty();
      onWorldItemChange();
    },
  }),
);
scheduler.add(makeFurnaceExpelSystem(tileGrid));
scheduler.add(makeEaselSystem(jobBoard, tileGrid));
scheduler.add(makeItemRescueSystem(tileGrid, () => onWorldItemChange()));
// Forward-declared so the rooms system can poke the overlay's dirty flag
// once the renderer (constructed below) is in scope.
let onRoomsRebuilt = () => {};
scheduler.add(makeRoomsSystem({ rooms, onRebuilt: () => onRoomsRebuilt() }));

if (stressCount > 0) spawnStressEntities(world, stressCount);
spawnInitialTrees(world, tileGrid, treeCount);
spawnInitialBoulders(world, tileGrid, treeCount);
spawnInitialCows(world, tileGrid, cowCount);

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
const { renderer, scene, camera, sun, hemi, sky } = createScene(canvas);
const audio = createAudio({ camera });
const timeOfDay = createTimeOfDay({ sun, hemi, sky });
const weather = createWeather({ scene, timeOfDay, sun, hemi, audio });
const lightingSystem = makeLightingSystem({ grid: tileGrid, timeOfDay });
scheduler.add(lightingSystem);
scheduler.add(
  makeGrowthSystem({
    grid: tileGrid,
    timeOfDay,
    onStageChange: () => {
      // Forward-decl safe: cropInstancer exists by the time the first tick fires.
      cropInstancer.markDirty();
    },
  }),
);
scheduler.add(
  makeTreeGrowthSystem({
    // Forward-decl safe: treeInstancer exists by the time the first tick fires.
    onGrowthChange: () => treeInstancer.markDirty(),
  }),
);
scheduler.add(
  makeSaplingSpawnSystem({
    grid: tileGrid,
    onSpawn: () => {
      treeInstancer.markDirty();
      // New tree tiles are `occupancy=1` — paths through the newly blocked
      // tile need to be re-planned on the next wake.
      pathCache.clear();
    },
  }),
);
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
const instancers = setupInstancers({ scene, audio, gridW, gridH });
const {
  cowInstancer,
  cowNameTags,
  cowThoughtBubbles,
  selectionViz,
  itemSelectionViz,
  treeInstancer,
  boulderInstancer,
  wallInstancer,
  doorInstancer,
  torchInstancer,
  roofInstancer,
  roofCollapseParticles,
  floorInstancer,
  furnaceInstancer,
  furnaceEffects,
  furnaceProgressBars,
  furnaceSelectionViz,
  easelInstancer,
  paintingInstancer,
  buildSiteInstancer,
  cropInstancer,
  cuttableMarkerInstancer,
  itemInstancer,
  itemLabels,
  stockpileOverlay,
  farmZoneOverlay,
  tilledOverlay,
  roomOverlay,
  ignoreRoofOverlay,
  deconstructOverlay,
  pickTileOverlay,
} = instancers;

({
  onWorldChopComplete,
  onWorldMineComplete,
  onWorldCowEat,
  onWorldCowStep,
  onWorldCowHammer,
  onWorldTillComplete,
  onWorldPlantComplete,
  onWorldHarvestComplete,
  onWorldBuildComplete,
  onRoomsRebuilt,
  onWorldItemChange,
} = setupWorldCallbacks({
  world,
  tileGrid,
  pathCache,
  jobBoard,
  scheduler,
  rooms,
  audio,
  instancers,
}));

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
  selectedItems: new Set(),
  selectedFurnaces: new Set(),
  primaryFurnace: null,
  selectedEasels: new Set(),
  primaryEasel: null,
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
    state.selectedItems.clear();
    state.selectedFurnaces.clear();
    state.primaryFurnace = null;
    state.selectedEasels.clear();
    state.primaryEasel = null;
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

new CowSelector(canvas, camera, cowInstancer, () => state.tileMesh, world, selectCow);

/**
 * Shared item-selection callback. Stacks + cows are mutually exclusive — a
 * non-additive item click clears cows (and selectCow clears items). Keeps
 * the HUD simple: one selection pane, one subject.
 *
 * @param {number | null} id
 * @param {boolean} additive
 */
const selectItem = (id, additive) => {
  if (id === null) {
    if (!additive) state.selectedItems.clear();
  } else if (additive) {
    if (state.selectedItems.has(id)) state.selectedItems.delete(id);
    else state.selectedItems.add(id);
    audio.play('click');
  } else {
    state.selectedCows.clear();
    state.primaryCow = null;
    state.selectedItems.clear();
    state.selectedItems.add(id);
    state.selectedFurnaces.clear();
    state.primaryFurnace = null;
    state.selectedEasels.clear();
    state.primaryEasel = null;
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

/** @param {number[]} ids */
const selectItemsMany = (ids) => {
  state.selectedCows.clear();
  state.primaryCow = null;
  state.selectedItems.clear();
  state.selectedFurnaces.clear();
  state.primaryFurnace = null;
  state.selectedEasels.clear();
  state.primaryEasel = null;
  for (const id of ids) state.selectedItems.add(id);
  if (ids.length > 0) audio.play('command');
  itemSelectionViz.markDirty();
  updateHud();
};

/**
 * Furnace selection mirrors cows/items. Exclusive with them — a furnace click
 * clears cow + item selection.
 *
 * @param {number | null} id
 * @param {boolean} additive
 */
const selectFurnace = (id, additive) => {
  if (id === null) {
    if (!additive) {
      state.selectedFurnaces.clear();
      state.primaryFurnace = null;
    }
  } else if (additive) {
    if (state.selectedFurnaces.has(id)) {
      state.selectedFurnaces.delete(id);
      if (state.primaryFurnace === id) {
        state.primaryFurnace =
          state.selectedFurnaces.size > 0
            ? /** @type {number} */ (state.selectedFurnaces.values().next().value)
            : null;
      }
    } else {
      state.selectedFurnaces.add(id);
      state.primaryFurnace = id;
    }
    audio.play('click');
  } else {
    state.selectedCows.clear();
    state.primaryCow = null;
    state.selectedItems.clear();
    state.selectedFurnaces.clear();
    state.selectedFurnaces.add(id);
    state.primaryFurnace = id;
    state.selectedEasels.clear();
    state.primaryEasel = null;
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

/**
 * Easel selection mirrors furnace selection — mutex with cows/items/furnaces.
 *
 * @param {number | null} id
 * @param {boolean} additive
 */
const selectEasel = (id, additive) => {
  if (id === null) {
    if (!additive) {
      state.selectedEasels.clear();
      state.primaryEasel = null;
    }
  } else if (additive) {
    if (state.selectedEasels.has(id)) {
      state.selectedEasels.delete(id);
      if (state.primaryEasel === id) {
        state.primaryEasel =
          state.selectedEasels.size > 0
            ? /** @type {number} */ (state.selectedEasels.values().next().value)
            : null;
      }
    } else {
      state.selectedEasels.add(id);
      state.primaryEasel = id;
    }
    audio.play('click');
  } else {
    state.selectedCows.clear();
    state.primaryCow = null;
    state.selectedItems.clear();
    state.selectedFurnaces.clear();
    state.primaryFurnace = null;
    state.selectedEasels.clear();
    state.selectedEasels.add(id);
    state.primaryEasel = id;
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

// Station selectors fire in capture-phase BEFORE ItemSelector so a click on
// a station tile wins even when an item stack sits on the same tile. Tile-
// based picking resolves clicks anywhere within the station's footprint.
new StationSelector(
  canvas,
  camera,
  () => state.tileMesh,
  { W: gridW, H: gridH },
  world,
  'Furnace',
  selectFurnace,
);
new StationSelector(
  canvas,
  camera,
  () => state.tileMesh,
  { W: gridW, H: gridH },
  world,
  'Easel',
  selectEasel,
);

new ItemSelector(
  canvas,
  camera,
  () => state.tileMesh,
  { W: gridW, H: gridH },
  world,
  selectItem,
  selectItemsMany,
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

const prioritizeMenu = createPrioritizeMenu();

new CowMoveCommand(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  pathCache,
  defaultWalkable,
  world,
  jobBoard,
  () => state.selectedCows,
  scene,
  prioritizeMenu,
  audio,
);

const {
  chopDesignator,
  cutDesignator,
  mineDesignator,
  stockpileDesignator,
  farmZoneDesignator,
  wallDesignator,
  doorDesignator,
  torchDesignator,
  wallTorchDesignator,
  roofDesignator,
  floorDesignator,
  furnaceDesignator,
  easelDesignator,
  ignoreRoofDesignator,
  deconstructDesignator,
  removeRoofDesignator,
  removeFloorDesignator,
  cancelDesignator,
} = setupDesignators({
  canvas,
  camera,
  scene,
  audio,
  tileGrid,
  world,
  jobBoard,
  state,
  instancers,
  updateHud,
});

const fpCamera = new FirstPersonCamera(camera, canvas, world, () => updateHud());
getDrivingCowId = () => fpCamera.drivingCowId;
const cowCamOverlay = createCowCamOverlay();
const draftBadge = createDraftBadge(scene, 256);

const buildTab = createBuildTab({
  chopDesignator,
  cutDesignator,
  mineDesignator,
  stockpileDesignator,
  farmZoneDesignator,
  wallDesignator,
  doorDesignator,
  torchDesignator,
  wallTorchDesignator,
  roofDesignator,
  floorDesignator,
  furnaceDesignator,
  easelDesignator,
  ignoreRoofDesignator,
  deconstructDesignator,
  removeRoofDesignator,
  removeFloorDesignator,
  cancelDesignator,
});

const itemStackPanel = createItemStackPanel({
  world,
  state,
  board: jobBoard,
  onChange: () => {
    itemInstancer.markDirty();
    itemSelectionViz.markDirty();
    updateHud();
  },
});

const furnacePanel = createFurnacePanel({
  world,
  state,
  onChange: () => {
    furnaceInstancer.markDirty();
    updateHud();
  },
});

const easelPanel = createEaselPanel({
  world,
  state,
  onChange: () => {
    easelInstancer.markDirty();
    updateHud();
  },
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

const { render, getFps } = createRenderFrame({
  world,
  tileGrid,
  rooms,
  state,
  renderer,
  scene,
  camera,
  sky,
  rts,
  fpCamera,
  audio,
  timeOfDay,
  weather,
  cowCamOverlay,
  draftBadge,
  stressInstancer,
  instancers,
  cowPortraitBar,
  itemStackPanel,
  furnacePanel,
  easelPanel,
  buildTab,
  clockEl,
  getSpeed: () => loop.speed,
  updateHud,
  pruneStaleSelections,
});

const loop = new SimLoop({
  step(dt, tick) {
    scheduler.tick(world, tick, dt);
  },
  render,
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
  getFps,
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
  itemSelectionViz,
  treeInstancer,
  boulderInstancer,
  stockpileOverlay,
  farmZoneOverlay,
  tilledOverlay,
  rooms,
  roomOverlay,
  ignoreRoofOverlay,
  roofInstancer,
  floorInstancer,
  furnaceInstancer,
  buildSiteInstancer,
  wallInstancer,
  cropInstancer,
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
