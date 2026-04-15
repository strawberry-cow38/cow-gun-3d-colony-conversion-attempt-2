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
import { createBoulderInstancer } from './render/boulderInstancer.js';
import {
  BuildDesignator,
  DOOR_DESIGNATOR_CONFIG,
  FLOOR_DESIGNATOR_CONFIG,
  FURNACE_DESIGNATOR_CONFIG,
  ROOF_DESIGNATOR_CONFIG,
  TORCH_DESIGNATOR_CONFIG,
  WALL_DESIGNATOR_CONFIG,
  WALL_TORCH_DESIGNATOR_CONFIG,
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
import { createCropInstancer } from './render/cropInstancer.js';
import { CutDesignator } from './render/cutDesignator.js';
import { createCuttableMarkerInstancer } from './render/cuttableMarkerInstancer.js';
import { DeconstructDesignator } from './render/deconstructDesignator.js';
import { createDeconstructOverlay } from './render/deconstructOverlay.js';
import { createDoorInstancer } from './render/doorInstancer.js';
import { createDraftBadge } from './render/draftBadge.js';
import { FarmZoneDesignator } from './render/farmZoneDesignator.js';
import { createFarmZoneOverlay } from './render/farmZoneOverlay.js';
import { FirstPersonCamera } from './render/firstPersonCamera.js';
import { createFloorInstancer } from './render/floorInstancer.js';
import { createFurnaceEffects } from './render/furnaceEffects.js';
import { createFurnaceInstancer } from './render/furnaceInstancer.js';
import { createFurnacePanel } from './render/furnacePanel.js';
import { createFurnaceProgressBars } from './render/furnaceProgressBars.js';
import { FurnaceSelector } from './render/furnaceSelector.js';
import { IgnoreRoofDesignator } from './render/ignoreRoofDesignator.js';
import { createIgnoreRoofOverlay } from './render/ignoreRoofOverlay.js';
import { createItemInstancer } from './render/itemInstancer.js';
import { createItemLabels } from './render/itemLabels.js';
import { createItemSelectionViz } from './render/itemSelectionViz.js';
import { ItemSelector } from './render/itemSelector.js';
import { createItemStackPanel } from './render/itemStackPanel.js';
import { MineDesignator } from './render/mineDesignator.js';
import { CowMoveCommand } from './render/moveCommand.js';
import { createPickTileOverlay } from './render/pickTileOverlay.js';
import { TilePicker } from './render/picker.js';
import { createRoofCollapseParticles } from './render/roofCollapseParticles.js';
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
import { createTilledOverlay } from './render/tilledOverlay.js';
import { createTorchInstancer } from './render/torchInstancer.js';
import { createTreeInstancer } from './render/treeInstancer.js';
import { createWallInstancer } from './render/wallInstancer.js';
import { SimLoop } from './sim/loop.js';
import { PathCache, defaultWalkable } from './sim/pathfinding.js';
import { spawnStressEntities, stressBounce } from './stress.js';
import { runAutoRoof } from './systems/autoRoof.js';
import { spawnInitialBoulders } from './systems/boulders.js';
import {
  makeCowBrainSystem,
  makeCowFollowPathSystem,
  makeCowWallCollisionSystem,
  makeHungerSystem,
} from './systems/cow.js';
import { makeFarmPostingSystem } from './systems/farm.js';
import { makeFurnaceSystem } from './systems/furnace.js';
import { makeFurnaceExpelSystem } from './systems/furnaceExpel.js';
import { makeGrowthSystem } from './systems/growth.js';
import { makeLightingSystem } from './systems/lighting.js';
import { applyVelocity, snapshotPositions } from './systems/movement.js';
import { runRoofCollapse } from './systems/roofCollapse.js';
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
const cowInstancer = createCowInstancer(scene, 256);
const cowNameTags = createCowNameTags(scene);
const cowThoughtBubbles = createCowThoughtBubbles(scene);
const selectionViz = createSelectionViz(scene);
const itemSelectionViz = createItemSelectionViz(scene);
const treeInstancer = createTreeInstancer(scene, 2048);
const boulderInstancer = createBoulderInstancer(scene, 4096);
const wallInstancer = createWallInstancer(scene, 2048);
const doorInstancer = createDoorInstancer(scene, 512, audio);
const torchInstancer = createTorchInstancer(scene, 512);
const roofInstancer = createRoofInstancer(scene, gridW * gridH);
const roofCollapseParticles = createRoofCollapseParticles(scene);
const floorInstancer = createFloorInstancer(scene, gridW * gridH);
const furnaceInstancer = createFurnaceInstancer(scene, 256);
const furnaceEffects = createFurnaceEffects(scene);
const furnaceProgressBars = createFurnaceProgressBars(scene);
const buildSiteInstancer = createBuildSiteInstancer(scene, 1024);
const cropInstancer = createCropInstancer(scene, 1024);
const cuttableMarkerInstancer = createCuttableMarkerInstancer(scene, 256);
const itemInstancer = createItemInstancer(scene, 1024);
const itemLabels = createItemLabels(scene);
const stockpileOverlay = createStockpileOverlay(scene, gridW * gridH);
const farmZoneOverlay = createFarmZoneOverlay(scene, gridW * gridH);
const tilledOverlay = createTilledOverlay(scene, gridW * gridH);
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
onWorldMineComplete = (pos) => {
  boulderInstancer.markDirty();
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
onWorldTillComplete = (pos) => {
  tilledOverlay.markDirty();
  audio.playAt('chop', pos);
};
onWorldPlantComplete = (pos) => {
  cropInstancer.markDirty();
  audio.playAt('chop', pos);
};
onWorldHarvestComplete = (pos) => {
  cropInstancer.markDirty();
  itemInstancer.markDirty();
  audio.playAt('chop', pos);
};
onWorldBuildComplete = (pos, kind) => {
  wallInstancer.markDirty();
  roofInstancer.markDirty();
  floorInstancer.markDirty();
  furnaceInstancer.markDirty();
  buildSiteInstancer.markDirty();
  deconstructOverlay.markDirty();
  // Walls/doors/furnaces all change walkability (furnace blocks its tile via
  // the generic occupancy bitmap; door deconstruct/build flips the door bit).
  // Torches/floors/roofs stay passable, so skip the cache invalidation +
  // topology rebuild for them — that keeps the stutter off when the player
  // drops a row of torches or floors.
  if (kind === 'wall' || kind === 'door' || kind === 'furnace') {
    pathCache.clear();
    scheduler.dirty.mark('topology');
  }
  audio.playAt('hammer', pos);
};
onRoomsRebuilt = () => {
  roomOverlay.markDirty();
  // Collapse any roofs that lost their support chain (a wall got demolished
  // out from under them). Fires BEFORE auto-roof so the auto-roofer doesn't
  // immediately re-queue blueprints for tiles that are about to be torn down.
  const { collapsed, supported } = runRoofCollapse(world, tileGrid);
  for (const pos of collapsed) {
    roofCollapseParticles.burst(pos.x, pos.y, pos.z);
    audio.playAt('chop', pos);
  }
  if (collapsed.length > 0) pathCache.clear();
  // Hand the freshly-computed supported set to the renderer so it doesn't
  // BFS again on its own dirty pulse. Mark dirty unconditionally — a
  // topology change could have colored a standing roof differently even if
  // no roofs collapsed.
  roofInstancer.markDirty(supported);
  // Auto-queue roofs for newly enclosed rooms. Runs in the same tick as the
  // flood-fill so the next rare haul-poster tick sees the fresh BuildSites.
  runAutoRoof(world, tileGrid, jobBoard, rooms);
  buildSiteInstancer.markDirty();
};
onWorldItemChange = () => {
  itemInstancer.markDirty();
  itemSelectionViz.markDirty();
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
  selectedItems: new Set(),
  selectedFurnaces: new Set(),
  primaryFurnace: null,
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
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

// FurnaceSelector registered BEFORE ItemSelector so a click on a furnace
// mesh wins even when an item stack sits on the same tile. It only stops
// propagation on a mesh hit — misses fall through to the item picker.
new FurnaceSelector(
  canvas,
  camera,
  () => [furnaceInstancer.bodyMesh, furnaceInstancer.chimneyMesh],
  (instanceId) => furnaceInstancer.entityFromInstanceId(instanceId),
  selectFurnace,
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

const cutDesignator = new CutDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  treeInstancer,
  cropInstancer,
  world,
  jobBoard,
  scene,
  () => {
    deactivateOthers(cutDesignator);
    updateHud();
  },
  audio,
);
designators.push(cutDesignator);

const mineDesignator = new MineDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  boulderInstancer,
  world,
  jobBoard,
  scene,
  () => {
    deactivateOthers(mineDesignator);
    updateHud();
  },
  audio,
);
designators.push(mineDesignator);

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

const farmZoneDesignator = new FarmZoneDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  farmZoneOverlay,
  scene,
  () => {
    deactivateOthers(farmZoneDesignator);
    updateHud();
  },
  audio,
);
designators.push(farmZoneDesignator);

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

const wallTorchDesignator = new BuildDesignator(
  WALL_TORCH_DESIGNATOR_CONFIG,
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  buildSiteInstancer,
  scene,
  () => {
    deactivateOthers(wallTorchDesignator);
    updateHud();
  },
  audio,
);
designators.push(wallTorchDesignator);

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

const floorDesignator = new BuildDesignator(
  FLOOR_DESIGNATOR_CONFIG,
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  buildSiteInstancer,
  scene,
  () => {
    deactivateOthers(floorDesignator);
    updateHud();
  },
  audio,
);
designators.push(floorDesignator);

const furnaceDesignator = new BuildDesignator(
  FURNACE_DESIGNATOR_CONFIG,
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  buildSiteInstancer,
  scene,
  () => {
    deactivateOthers(furnaceDesignator);
    updateHud();
  },
  audio,
);
designators.push(furnaceDesignator);

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
  [wallInstancer, floorInstancer, furnaceInstancer, deconstructOverlay],
  scene,
  () => {
    deactivateOthers(deconstructDesignator);
    updateHud();
  },
  audio,
);
designators.push(deconstructDesignator);

const removeRoofDesignator = new DeconstructDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  [roofInstancer, deconstructOverlay, ignoreRoofOverlay],
  scene,
  () => {
    deactivateOthers(removeRoofDesignator);
    updateHud();
  },
  audio,
  {
    kinds: [{ comp: 'Roof', kind: 'roof' }],
    previewColor: 0xff8fd0,
    tagIgnoreRoof: true,
    addVerb: 'un-roof',
    cancelVerb: 'cancel un-roof',
  },
);
designators.push(removeRoofDesignator);

const removeFloorDesignator = new DeconstructDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  [floorInstancer, deconstructOverlay],
  scene,
  () => {
    deactivateOthers(removeFloorDesignator);
    updateHud();
  },
  audio,
  {
    kinds: [{ comp: 'Floor', kind: 'floor' }],
    previewColor: 0xd4a14a,
    addVerb: 'un-floor',
    cancelVerb: 'cancel un-floor',
  },
);
designators.push(removeFloorDesignator);

const cancelDesignator = new CancelDesignator(
  canvas,
  camera,
  () => state.tileMesh,
  tileGrid,
  world,
  jobBoard,
  buildSiteInstancer,
  [wallInstancer, roofInstancer, floorInstancer, furnaceInstancer, deconstructOverlay],
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
    boulderInstancer.update(world, tileGrid);
    boulderInstancer.updateMarkers(world, tileGrid, tSec);
    wallInstancer.update(world, tileGrid);
    doorInstancer.update(world, tileGrid);
    torchInstancer.update(world, tileGrid, tSec, camera);
    roofInstancer.update(world, tileGrid);
    floorInstancer.update(world, tileGrid);
    furnaceInstancer.update(world, tileGrid);
    furnaceInstancer.updateGlow(tSec);
    furnaceEffects.update(world, tileGrid, rdt, tSec, camera);
    furnaceProgressBars.update(world, tileGrid, camera);
    roofCollapseParticles.update(rdt);
    buildSiteInstancer.update(world, tileGrid);
    cropInstancer.update(world, tileGrid);
    cuttableMarkerInstancer.updateMarkers(world, tileGrid, tSec);
    itemInstancer.update(world, tileGrid);
    itemLabels.update(world, camera, tileGrid);
    stockpileOverlay.update(tileGrid);
    farmZoneOverlay.update(tileGrid);
    tilledOverlay.update(tileGrid);
    roomOverlay.update(tileGrid, rooms);
    ignoreRoofOverlay.update(tileGrid);
    deconstructOverlay.update(world, tileGrid);
    pickTileOverlay.update(tileGrid, state.lastPick);
    pruneStaleSelections();
    cowPortraitBar.update();
    itemStackPanel.update();
    furnacePanel.update();
    buildTab.update();
    selectionViz.update(world, state.selectedCows, alpha, tSec, tileGrid);
    itemSelectionViz.update(world, tileGrid, state.selectedItems);
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
