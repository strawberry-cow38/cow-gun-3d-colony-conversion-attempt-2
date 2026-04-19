/**
 * Main entry: tile world + cows + jobs + save/load.
 *
 * Stress test stays behind ?stress=N; cow count overridable via ?cows=N
 * (default 10).
 */

import { createAudio } from './audio/audio.js';
import { createHud } from './boot/hud.js';
import { installKeyboard } from './boot/input.js';
import { createLayerSwitcher } from './boot/layerSwitcher.js';
import { readBootParams } from './boot/params.js';
import { createRenderFrame } from './boot/renderFrame.js';
import { setupDesignators } from './boot/setupDesignators.js';
import { setupInstancers } from './boot/setupInstancers.js';
import { setupWorldCallbacks } from './boot/setupWorldCallbacks.js';
import { spawnInitialCows } from './boot/spawn.js';
import { registerComponents } from './components/index.js';
import { printHaulDebugHint } from './debug/haulDebug.js';
import { Scheduler } from './ecs/schedule.js';
import { World } from './ecs/world.js';
import { JobBoard } from './jobs/board.js';
import { makeHaulPostingSystem } from './jobs/haul.js';
import { createBedPanel } from './render/bedPanel.js';
import { createBuildTab } from './render/buildTab.js';
import { createCowCamOverlay } from './render/cowCamOverlay.js';
import { createCowPanel } from './render/cowPanel.js';
import { createCowPortraitBar } from './render/cowPortraitBar.js';
import { CowSelector } from './render/cowSelector.js';
import { createDraftBadge } from './render/draftBadge.js';
import { FirstPersonCamera } from './render/firstPersonCamera.js';
import { createEaselPanel, createFurnacePanel, createStovePanel } from './render/furnacePanel.js';
import { HoverTooltip } from './render/hoverTooltip.js';
import { ItemSelector } from './render/itemSelector.js';
import { createItemStackPanel } from './render/itemStackPanel.js';
import { CowMoveCommand } from './render/moveCommand.js';
import { createObjectPanel } from './render/objectPanel.js';
import { ObjectSelector } from './render/objectSelector.js';
import { TilePicker } from './render/picker.js';
import { createPrioritizeMenu } from './render/prioritizeMenu.js';
import { RtsCamera } from './render/rtsCamera.js';
import { createScene } from './render/scene.js';
import { SelectionBox } from './render/selectionBox.js';
import { createStockpilePanel } from './render/stockpilePanel.js';
import { StockpileSelector } from './render/stockpileSelector.js';
import { createStressInstancer } from './render/stressInstancer.js';
import { buildTileMesh, buildWaterSurface } from './render/tileMesh.js';
import { WallArtSelector } from './render/wallArtSelector.js';
import { createWorkTab } from './render/workTab.js';
import { TICKS_PER_SIM_HOUR, dayFractionOfTick } from './sim/calendar.js';
import { SimLoop } from './sim/loop.js';
import { PathCache, defaultWalkable } from './sim/pathfinding.js';
import { spawnStressEntities, stressBounce } from './stress.js';
import { spawnInitialBoulders } from './systems/boulders.js';
import {
  makeCowBrainSystem,
  makeCowFollowPathSystem,
  makeCowWallCollisionSystem,
  makeHungerSystem,
  makeTirednessSystem,
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
import { makeSocialSystem } from './systems/social.js';
import { createStockpileZones } from './systems/stockpileZones.js';
import { makeStoveSystem } from './systems/stove.js';
import {
  makeSaplingSpawnSystem,
  makeTreeGrowthSystem,
  spawnInitialTrees,
} from './systems/trees.js';
import { TILE_SIZE } from './world/coords.js';
import { TileGrid } from './world/tileGrid.js';
import { TileWorld } from './world/tileWorld.js';
import { createTimeOfDay } from './world/timeOfDay.js';
import { createWeather } from './world/weather.js';

const { stressCount, cowCount, treeCount, gridW, gridH } = readBootParams();

const tileWorld = new TileWorld(new TileGrid(gridW, gridH));
tileWorld.active.generateTerrain();
// Stack 4 empty upper layers so Q/E has somewhere to go. Ramps + structures
// will progressively populate them; the ground layer holds the heightmap.
while (tileWorld.depth < 5) tileWorld.pushEmptyLayer();
// Alias to the active (ground) layer. Every system still operates on a single
// layer today, so the existing `tileGrid`-typed parameters stay valid; future
// z-aware code can reach the full stack via `tileWorld.layers`.
const tileGrid = tileWorld.active;

const world = new World();
registerComponents(world);

const pathCache = new PathCache(tileWorld, defaultWalkable);
const jobBoard = new JobBoard();
const rooms = createRooms(tileGrid);
const stockpileZones = createStockpileZones(tileGrid);

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
    tileWorld,
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
    tileWorld,
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
scheduler.add(makeTirednessSystem());
scheduler.add(makeHaulPostingSystem(jobBoard, tileGrid, pathCache));
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
scheduler.add(makeStoveSystem(jobBoard, tileGrid));
scheduler.add(makeItemRescueSystem(tileGrid, () => onWorldItemChange()));
// Forward-declared so the rooms system can poke the overlay's dirty flag
// once the renderer (constructed below) is in scope.
let onRoomsRebuilt = () => {};
scheduler.add(makeRoomsSystem({ rooms, onRebuilt: () => onRoomsRebuilt() }));
scheduler.add(makeSocialSystem());

if (stressCount > 0) spawnStressEntities(world, stressCount);
spawnInitialTrees(world, tileGrid, treeCount);
spawnInitialBoulders(world, tileGrid, treeCount);
spawnInitialCows(world, tileGrid, cowCount);

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
const { renderer, scene, camera, sun, hemi, sky, sunDisc, moonDisc } = createScene(canvas);
const audio = createAudio({ camera });
const timeOfDay = createTimeOfDay({
  sun,
  hemi,
  sky,
  sunDisc,
  moonDisc,
  camera,
  initialT: dayFractionOfTick(0),
});
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
const instancers = setupInstancers({ scene, audio, gridW, gridH, tileGrid });
const {
  cowInstancer,
  cowHitboxes,
  cowNameTags,
  cowThoughtBubbles,
  selectionViz,
  itemSelectionViz,
  objectHitboxes,
  treeInstancer,
  boulderInstancer,
  wallInstancer,
  doorInstancer,
  torchInstancer,
  roofInstancer,
  roofCollapseParticles,
  floorInstancer,
  flowerInstancer,
  furnaceInstancer,
  furnaceEffects,
  stationProgressBars,
  stationSelectionViz,
  easelInstancer,
  stoveInstancer,
  bedInstancer,
  paintingInstancer,
  wallArtInstancer,
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

// Zone registry tips the overlay any time a zone's tiles or filter change,
// so the flat sky-blue quads update in-place without per-frame scans.
stockpileZones.setOnChanged(() => stockpileOverlay.markDirty());

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
  debugEnabled: false,
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
  selectedStoves: new Set(),
  primaryStove: null,
  selectedBeds: new Set(),
  primaryBed: null,
  selectedStairs: new Set(),
  primaryStair: null,
  selectedObjects: new Set(),
  primaryObject: null,
  selectedZoneId: null,
  lastPick: null,
  tileMesh: buildTileMesh(tileGrid),
  waterMesh: /** @type {import('three').Mesh | null} */ (buildWaterSurface(tileGrid)),
  tickOffset: 0,
};
scene.add(state.tileMesh);
if (state.waterMesh) scene.add(state.waterMesh);

// hudApi is populated below once all the refs (designators, fpCamera) exist,
// but selection callbacks, designator callbacks, and the render loop all
// reference updateHud/pruneStaleSelections during construction. Bouncing
// through wrappers keeps the declaration order simple.
/** @type {import('./boot/hud.js').HudApi | null} */
let hudApi = null;
const updateHud = () => hudApi?.updateHud();
const pruneStaleSelections = () => hudApi?.pruneStaleSelections();

/**
 * Wipe every selection bucket other than the one named by `keep`. A plain
 * (non-additive) pick is exclusive: picking a cow drops item/station/object
 * selections, picking an object drops cow/item/station, and so on.
 *
 * @param {'cows'|'items'|'furnaces'|'easels'|'stoves'|'beds'|'stairs'|'objects'|'stockpileZone'} keep
 */
const clearOtherSelections = (keep) => {
  if (keep !== 'cows') {
    state.selectedCows.clear();
    state.primaryCow = null;
  }
  if (keep !== 'items') {
    state.selectedItems.clear();
  }
  if (keep !== 'furnaces') {
    state.selectedFurnaces.clear();
    state.primaryFurnace = null;
  }
  if (keep !== 'easels') {
    state.selectedEasels.clear();
    state.primaryEasel = null;
  }
  if (keep !== 'stoves') {
    state.selectedStoves.clear();
    state.primaryStove = null;
  }
  if (keep !== 'beds') {
    state.selectedBeds.clear();
    state.primaryBed = null;
  }
  if (keep !== 'stairs') {
    state.selectedStairs.clear();
    state.primaryStair = null;
  }
  if (keep !== 'objects') {
    state.selectedObjects.clear();
    state.primaryObject = null;
  }
  if (keep !== 'stockpileZone') {
    state.selectedZoneId = null;
  }
};

// Marquee BEFORE CowSelector so its capture-phase handler swallows the post-drag click first.
new SelectionBox(canvas, camera, world, (ids, additive) => {
  if (!additive) {
    if (ids.length > 0) clearOtherSelections('cows');
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
    clearOtherSelections('cows');
    state.selectedCows.clear();
    state.selectedCows.add(id);
    state.primaryCow = id;
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

// Designators are wired later; late-bind the getter so any armed build tool
// suppresses world-object click selection.
/** @type {() => boolean} */
let isDesignatorArmedImpl = () => false;
const isDesignatorArmed = () => isDesignatorArmedImpl();

new CowSelector(canvas, camera, cowHitboxes, () => state.tileMesh, world, selectCow, {
  isDesignatorActive: isDesignatorArmed,
});

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
    clearOtherSelections('items');
    state.selectedItems.clear();
    state.selectedItems.add(id);
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

/** @param {number[]} ids */
const selectItemsMany = (ids) => {
  clearOtherSelections('items');
  state.selectedItems.clear();
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
    clearOtherSelections('furnaces');
    state.selectedFurnaces.clear();
    state.selectedFurnaces.add(id);
    state.primaryFurnace = id;
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
    clearOtherSelections('easels');
    state.selectedEasels.clear();
    state.selectedEasels.add(id);
    state.primaryEasel = id;
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

/**
 * Stove selection mirrors easel selection — mutex with cows/items/furnaces/easels.
 *
 * @param {number | null} id
 * @param {boolean} additive
 */
const selectStove = (id, additive) => {
  if (id === null) {
    if (!additive) {
      state.selectedStoves.clear();
      state.primaryStove = null;
    }
  } else if (additive) {
    if (state.selectedStoves.has(id)) {
      state.selectedStoves.delete(id);
      if (state.primaryStove === id) {
        state.primaryStove =
          state.selectedStoves.size > 0
            ? /** @type {number} */ (state.selectedStoves.values().next().value)
            : null;
      }
    } else {
      state.selectedStoves.add(id);
      state.primaryStove = id;
    }
    audio.play('click');
  } else {
    clearOtherSelections('stoves');
    state.selectedStoves.clear();
    state.selectedStoves.add(id);
    state.primaryStove = id;
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

/**
 * Bed selection mirrors the other station selections — mutex with cows,
 * items, and other stations. The selected bed's panel lets the player
 * assign an owner from the colony roster.
 *
 * @param {number | null} id
 * @param {boolean} additive
 */
const selectBed = (id, additive) => {
  if (id === null) {
    if (!additive) {
      state.selectedBeds.clear();
      state.primaryBed = null;
    }
  } else if (additive) {
    if (state.selectedBeds.has(id)) {
      state.selectedBeds.delete(id);
      if (state.primaryBed === id) {
        state.primaryBed =
          state.selectedBeds.size > 0
            ? /** @type {number} */ (state.selectedBeds.values().next().value)
            : null;
      }
    } else {
      state.selectedBeds.add(id);
      state.primaryBed = id;
    }
    audio.play('click');
  } else {
    clearOtherSelections('beds');
    state.selectedBeds.clear();
    state.selectedBeds.add(id);
    state.primaryBed = id;
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

/**
 * @param {number | null} id
 * @param {boolean} additive
 */
const selectStair = (id, additive) => {
  if (id === null) {
    if (!additive) {
      state.selectedStairs.clear();
      state.primaryStair = null;
    }
  } else if (additive) {
    if (state.selectedStairs.has(id)) {
      state.selectedStairs.delete(id);
      if (state.primaryStair === id) {
        state.primaryStair =
          state.selectedStairs.size > 0
            ? /** @type {number} */ (state.selectedStairs.values().next().value)
            : null;
      }
    } else {
      state.selectedStairs.add(id);
      state.primaryStair = id;
    }
    audio.play('click');
  } else {
    clearOtherSelections('stairs');
    state.selectedStairs.clear();
    state.selectedStairs.add(id);
    state.primaryStair = id;
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

new ItemSelector(
  canvas,
  camera,
  () => state.tileMesh,
  { W: gridW, H: gridH },
  world,
  selectItem,
  selectItemsMany,
  { isDesignatorActive: isDesignatorArmed },
);

new WallArtSelector({
  canvas,
  camera,
  instancer: wallArtInstancer,
  tileGrid,
  world,
  jobBoard,
  audio,
  isDesignatorActive: isDesignatorArmed,
});

/**
 * Generic world-object selection (trees, boulders, walls, doors, torches,
 * roofs, floors). Mutex with the cow/item/station selections.
 *
 * @param {number | null} id
 * @param {boolean} additive
 */
const selectObject = (id, additive) => {
  if (id === null) {
    if (!additive) {
      state.selectedObjects.clear();
      state.primaryObject = null;
    }
  } else if (additive) {
    if (state.selectedObjects.has(id)) {
      state.selectedObjects.delete(id);
      if (state.primaryObject === id) {
        state.primaryObject =
          state.selectedObjects.size > 0
            ? /** @type {number} */ (state.selectedObjects.values().next().value)
            : null;
      }
    } else {
      state.selectedObjects.add(id);
      state.primaryObject = id;
    }
    audio.play('click');
  } else {
    clearOtherSelections('objects');
    state.selectedObjects.clear();
    state.selectedObjects.add(id);
    state.primaryObject = id;
    audio.play('click');
  }
  itemSelectionViz.markDirty();
  updateHud();
};

/** @param {number[]} ids */
const selectObjectsMany = (ids) => {
  clearOtherSelections('objects');
  state.selectedObjects.clear();
  for (const id of ids) state.selectedObjects.add(id);
  state.primaryObject = ids.length > 0 ? ids[0] : null;
  if (ids.length > 0) audio.play('command');
  itemSelectionViz.markDirty();
  updateHud();
};

// The hitbox mesh also covers crafting stations, so route picks on those
// to the specialized station select* handlers instead of the generic
// object bucket — stations have their own panels and mutex selection.
/**
 * @param {number | null} id
 * @param {boolean} additive
 */
const routeObjectPick = (id, additive) => {
  if (id !== null) {
    if (world.get(id, 'Furnace')) return selectFurnace(id, additive);
    if (world.get(id, 'Easel')) return selectEasel(id, additive);
    if (world.get(id, 'Stove')) return selectStove(id, additive);
    if (world.get(id, 'Bed')) return selectBed(id, additive);
    if (world.get(id, 'Stair')) return selectStair(id, additive);
    selectObject(id, additive);
    return;
  }
  // Ground click: clear every bucket ObjectSelector owns (objects + all
  // stations) so clicking empty terrain deselects a furnace/easel/stove/bed
  // the same way it drops a tree or wall selection.
  selectObject(null, additive);
  if (!additive) {
    selectFurnace(null, false);
    selectEasel(null, false);
    selectStove(null, false);
    selectBed(null, false);
    selectStair(null, false);
  }
};

new ObjectSelector({
  canvas,
  camera,
  tileMesh: () => state.tileMesh,
  grid: { W: gridW, H: gridH },
  world,
  hitboxes: objectHitboxes,
  onSelect: routeObjectPick,
  onSelectMany: selectObjectsMany,
  isDesignatorActive: isDesignatorArmed,
});

/** @param {number | null} id */
const selectStockpileZone = (id) => {
  if (id === null) {
    if (state.selectedZoneId === null) return;
    state.selectedZoneId = null;
  } else {
    if (state.selectedZoneId === id) return;
    clearOtherSelections('stockpileZone');
    state.selectedZoneId = id;
    audio.play('click');
  }
  updateHud();
};

new StockpileSelector({
  canvas,
  camera,
  tileMesh: () => state.tileMesh,
  grid: { W: gridW, H: gridH },
  stockpileZones,
  onSelect: selectStockpileZone,
  isDesignatorActive: isDesignatorArmed,
});

new TilePicker(
  canvas,
  camera,
  () => state.tileMesh,
  { W: gridW, H: gridH },
  (hit) => {
    state.lastPick = hit;
  },
);

new HoverTooltip({
  dom: canvas,
  el: /** @type {HTMLElement} */ (document.getElementById('hover-tooltip')),
  camera,
  tileMesh: () => state.tileMesh,
  grid: { W: gridW, H: gridH },
  tileGrid,
  world,
  cowHitboxes,
  objectHitboxes,
});

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
  {
    isDesignatorActive: isDesignatorArmed,
    getHitboxMesh: () => objectHitboxes.mesh,
    tileWorld,
  },
);

const {
  deactivateAllTools,
  isAnyToolActive,
  chopDesignator,
  cutDesignator,
  mineDesignator,
  stockpileDesignator,
  farmZoneDesignator,
  wallDesignator,
  halfWallDesignator,
  quarterWallDesignator,
  doorDesignator,
  torchDesignator,
  wallTorchDesignator,
  roofDesignator,
  floorDesignator,
  stairDesignator,
  furnaceDesignator,
  easelDesignator,
  stoveDesignator,
  bedDesignator,
  ignoreRoofDesignator,
  deconstructDesignator,
  removeRoofDesignator,
  removeFloorDesignator,
  installDesignator,
  uninstallDesignator,
  cancelDesignator,
} = setupDesignators({
  canvas,
  camera,
  scene,
  audio,
  tileGrid,
  tileWorld,
  world,
  jobBoard,
  state,
  instancers,
  stockpileZones,
  updateHud,
});
isDesignatorArmedImpl = isAnyToolActive;

// Right-click in the world viewport drops whatever tool the player had
// armed. Button popovers (stuff/crop picker) call stopPropagation on their
// own contextmenu, so this only runs for clicks that hit the canvas.
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  deactivateAllTools();
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
  halfWallDesignator,
  quarterWallDesignator,
  doorDesignator,
  torchDesignator,
  wallTorchDesignator,
  roofDesignator,
  floorDesignator,
  stairDesignator,
  furnaceDesignator,
  easelDesignator,
  stoveDesignator,
  bedDesignator,
  ignoreRoofDesignator,
  deconstructDesignator,
  removeRoofDesignator,
  removeFloorDesignator,
  uninstallDesignator,
  cancelDesignator,
});

const workTab = createWorkTab({ world });

const itemStackPanel = createItemStackPanel({
  world,
  state,
  board: jobBoard,
  onChange: () => {
    itemInstancer.markDirty();
    itemSelectionViz.markDirty();
    updateHud();
  },
  onInstall: (itemId, size) => installDesignator.activate(itemId, size),
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

const stovePanel = createStovePanel({
  world,
  state,
  onChange: () => {
    stoveInstancer.markDirty();
    updateHud();
  },
});

const bedPanel = createBedPanel({
  world,
  state,
  onChange: () => {
    bedInstancer.markDirty();
    updateHud();
  },
});

const stockpilePanel = createStockpilePanel({
  state,
  stockpileZones,
  onDelete: (id) => {
    stockpileZones.deleteZone(id);
    state.selectedZoneId = null;
    stockpileOverlay.markDirty();
    updateHud();
  },
  onChange: updateHud,
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

const cowPanel = createCowPanel({
  world,
  state,
  getTick: () => loop.tick,
});

const objectPanel = createObjectPanel({
  world,
  state,
  board: jobBoard,
  tileGrid,
  audio,
  onChange: () => {
    // Mark the instancers whose per-instance visuals flip on job post/cancel.
    // door/torch/furnace/easel re-evaluate every frame, so their job-id state
    // shows up for free.
    treeInstancer.markDirty();
    boulderInstancer.markDirty();
    wallInstancer.markDirty();
    roofInstancer.markDirty();
    floorInstancer.markDirty();
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
  sun,
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
  cowPanel,
  itemStackPanel,
  furnacePanel,
  easelPanel,
  stovePanel,
  bedPanel,
  stockpilePanel,
  objectPanel,
  buildTab,
  workTab,
  clockEl,
  getSpeed: () => loop.speed,
  getTick: () => loop.tick,
  getTps: () => loop.measuredHz,
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
  cowHitboxes,
  cowThoughtBubbles,
  roomOverlay,
  ignoreRoofOverlay,
  roofInstancer,
  pickTileOverlay,
  rooms,
  stockpileZones,
  timeOfDay,
  weather,
  getFps,
});

const layerSwitcher = createLayerSwitcher({
  tileWorld,
  rts,
  onChange: hudApi.updateHud,
});

installKeyboard({
  world,
  tileGrid,
  tileWorld,
  setActiveZ: layerSwitcher.setActiveZ,
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
  stockpileZones,
  roomOverlay,
  ignoreRoofOverlay,
  roofInstancer,
  floorInstancer,
  flowerInstancer,
  furnaceInstancer,
  wallArtInstancer,
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
  objectPanel,
  buildTab,
});

// Force THREE.js to compile every shader variant against the final scene
// graph before the first rendered frame. Without this, lit materials (cows,
// tiles, trees, walls, furniture) compile lazily on first draw and stutter
// the opening frames while the shadow-casting torch PointLights' variants
// work through the GL driver.
renderer.compile(scene, camera);

loop.start();
hudApi.updateHud();
printHaulDebugHint();

// Mobile-friendly debug button: jump sim clock forward 2 sim hours so the
// time-of-day shader / lighting can be eyeballed without waiting. Bumps the
// tick directly — sim systems skip those ticks, that's the trade for instant
// visual verification.
const debugSkipBtn = document.getElementById('debug-skip');
if (debugSkipBtn) {
  debugSkipBtn.addEventListener('click', () => {
    loop.tick += 2 * TICKS_PER_SIM_HOUR;
  });
}

const muteBtn = document.getElementById('audio-mute');
if (muteBtn) {
  audio.setMusicMuteListener((m) => {
    muteBtn.textContent = m ? '🔇' : '🎵';
    muteBtn.setAttribute('aria-label', m ? 'Unmute music' : 'Mute music');
  });
  muteBtn.addEventListener('click', () => {
    audio.toggleMusicMute();
  });
}
