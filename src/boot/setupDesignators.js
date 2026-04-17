/**
 * Construct every tile-painting designator (chop, mine, build, deconstruct, …).
 *
 * Each designator takes an options bag with the usual tile-picking quartet
 * (canvas/camera/tileMesh/tileGrid) plus scene/audio and its own extras. Two
 * pre-built bags — `baseArgs` (no-job designators) and `jobArgs` (job-posting
 * ones) — get spread at each call site so the per-designator wiring only
 * names the bits that actually differ.
 *
 * Each `onChanged` captures the `const` it's defined on; this is fine despite
 * the TDZ because the lambda only runs from DOM events, which can't fire
 * before construction returns. The shared `notifyChanged` walk deactivates
 * every other tool so the tile-paint modes stay mutually exclusive.
 */

import {
  BED_DESIGNATOR_CONFIG,
  BuildDesignator,
  DOOR_DESIGNATOR_CONFIG,
  EASEL_DESIGNATOR_CONFIG,
  FLOOR_DESIGNATOR_CONFIG,
  FURNACE_DESIGNATOR_CONFIG,
  ROOF_DESIGNATOR_CONFIG,
  STAIR_DESIGNATOR_CONFIG,
  STOVE_DESIGNATOR_CONFIG,
  TORCH_DESIGNATOR_CONFIG,
  WALL_DESIGNATOR_CONFIG,
  WALL_TORCH_DESIGNATOR_CONFIG,
} from '../render/buildDesignator.js';
import { CancelDesignator } from '../render/cancelDesignator.js';
import { ChopDesignator } from '../render/chopDesignator.js';
import { CutDesignator } from '../render/cutDesignator.js';
import { DeconstructDesignator } from '../render/deconstructDesignator.js';
import { FarmZoneDesignator } from '../render/farmZoneDesignator.js';
import { IgnoreRoofDesignator } from '../render/ignoreRoofDesignator.js';
import { InstallDesignator } from '../render/installDesignator.js';
import { MineDesignator } from '../render/mineDesignator.js';
import { StockpileDesignator } from '../render/stockpileDesignator.js';
import { UninstallDesignator } from '../render/uninstallDesignator.js';

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   camera: import('three').PerspectiveCamera,
 *   scene: import('three').Scene,
 *   audio: ReturnType<typeof import('../audio/audio.js').createAudio>,
 *   tileGrid: import('../world/tileGrid.js').TileGrid,
 *   tileWorld: import('../world/tileWorld.js').TileWorld,
 *   world: import('../ecs/world.js').World,
 *   jobBoard: import('../jobs/board.js').JobBoard,
 *   state: import('./input.js').BootState,
 *   instancers: ReturnType<typeof import('./setupInstancers.js').setupInstancers>,
 *   updateHud: () => void,
 * }} opts
 */
export function setupDesignators({
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
  updateHud,
}) {
  const {
    treeInstancer,
    boulderInstancer,
    wallInstancer,
    roofInstancer,
    floorInstancer,
    furnaceInstancer,
    easelInstancer,
    stoveInstancer,
    bedInstancer,
    buildSiteInstancer,
    cropInstancer,
    stockpileOverlay,
    farmZoneOverlay,
    ignoreRoofOverlay,
    deconstructOverlay,
  } = instancers;
  const tileMesh = () => state.tileMesh;

  /** @type {{ active: boolean, deactivate: () => void }[]} */
  const designators = [];
  /**
   * Activation of any designator deactivates the others (tiles can only be
   * in one designation mode at a time). Also pokes the HUD so the build tab
   * highlight follows the active tool.
   * @param {{ active: boolean, deactivate: () => void }} self
   */
  const notifyChanged = (self) => {
    if (self.active) {
      for (const d of designators) if (d !== self) d.deactivate();
    }
    updateHud();
  };

  // Shared arg bundles: every designator needs the tile-picking quartet plus
  // scene+audio; job-posting designators additionally need world+jobBoard.
  // Spreading these at each call site keeps the noise down without hiding
  // which extra dependencies a given designator pulls in.
  const baseArgs = { canvas, camera, tileMesh, tileGrid, tileWorld, scene, audio };
  const jobArgs = { ...baseArgs, world, jobBoard };

  const chopDesignator = new ChopDesignator({
    ...jobArgs,
    treeInstancer,
    onChanged: () => notifyChanged(chopDesignator),
  });
  designators.push(chopDesignator);

  const cutDesignator = new CutDesignator({
    ...jobArgs,
    treeInstancer,
    cropInstancer,
    onChanged: () => notifyChanged(cutDesignator),
  });
  designators.push(cutDesignator);

  const mineDesignator = new MineDesignator({
    ...jobArgs,
    boulderInstancer,
    onChanged: () => notifyChanged(mineDesignator),
  });
  designators.push(mineDesignator);

  const stockpileDesignator = new StockpileDesignator({
    ...baseArgs,
    overlay: stockpileOverlay,
    onChanged: () => notifyChanged(stockpileDesignator),
  });
  designators.push(stockpileDesignator);

  const farmZoneDesignator = new FarmZoneDesignator({
    ...baseArgs,
    jobBoard,
    overlay: farmZoneOverlay,
    onChanged: () => notifyChanged(farmZoneDesignator),
  });
  designators.push(farmZoneDesignator);

  const wallDesignator = new BuildDesignator({
    ...jobArgs,
    config: WALL_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    onChanged: () => notifyChanged(wallDesignator),
  });
  designators.push(wallDesignator);

  const doorDesignator = new BuildDesignator({
    ...jobArgs,
    config: DOOR_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    deconstructOverlay,
    onChanged: () => notifyChanged(doorDesignator),
  });
  designators.push(doorDesignator);

  const torchDesignator = new BuildDesignator({
    ...jobArgs,
    config: TORCH_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    onChanged: () => notifyChanged(torchDesignator),
  });
  designators.push(torchDesignator);

  const wallTorchDesignator = new BuildDesignator({
    ...jobArgs,
    config: WALL_TORCH_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    onChanged: () => notifyChanged(wallTorchDesignator),
  });
  designators.push(wallTorchDesignator);

  const roofDesignator = new BuildDesignator({
    ...jobArgs,
    config: ROOF_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    onChanged: () => notifyChanged(roofDesignator),
  });
  designators.push(roofDesignator);

  const floorDesignator = new BuildDesignator({
    ...jobArgs,
    config: FLOOR_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    onChanged: () => notifyChanged(floorDesignator),
  });
  designators.push(floorDesignator);

  const stairDesignator = new BuildDesignator({
    ...jobArgs,
    config: STAIR_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    onChanged: () => notifyChanged(stairDesignator),
  });
  designators.push(stairDesignator);

  const furnaceDesignator = new BuildDesignator({
    ...jobArgs,
    config: FURNACE_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    onChanged: () => notifyChanged(furnaceDesignator),
  });
  designators.push(furnaceDesignator);

  const easelDesignator = new BuildDesignator({
    ...jobArgs,
    config: EASEL_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    onChanged: () => notifyChanged(easelDesignator),
  });
  designators.push(easelDesignator);

  const stoveDesignator = new BuildDesignator({
    ...jobArgs,
    config: STOVE_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    onChanged: () => notifyChanged(stoveDesignator),
  });
  designators.push(stoveDesignator);

  const bedDesignator = new BuildDesignator({
    ...jobArgs,
    config: BED_DESIGNATOR_CONFIG,
    buildSiteInstancer,
    onChanged: () => notifyChanged(bedDesignator),
  });
  designators.push(bedDesignator);

  const ignoreRoofDesignator = new IgnoreRoofDesignator({
    ...baseArgs,
    overlay: ignoreRoofOverlay,
    onChanged: () => notifyChanged(ignoreRoofDesignator),
  });
  designators.push(ignoreRoofDesignator);

  const deconstructDesignator = new DeconstructDesignator({
    ...jobArgs,
    instancers: [
      wallInstancer,
      floorInstancer,
      furnaceInstancer,
      easelInstancer,
      stoveInstancer,
      bedInstancer,
      deconstructOverlay,
    ],
    onChanged: () => notifyChanged(deconstructDesignator),
  });
  designators.push(deconstructDesignator);

  const removeRoofDesignator = new DeconstructDesignator({
    ...jobArgs,
    instancers: [roofInstancer, deconstructOverlay, ignoreRoofOverlay],
    kinds: [{ comp: 'Roof', kind: 'roof' }],
    previewColor: 0xff8fd0,
    tagIgnoreRoof: true,
    addVerb: 'un-roof',
    cancelVerb: 'cancel un-roof',
    onChanged: () => notifyChanged(removeRoofDesignator),
  });
  designators.push(removeRoofDesignator);

  const removeFloorDesignator = new DeconstructDesignator({
    ...jobArgs,
    instancers: [floorInstancer, deconstructOverlay],
    kinds: [{ comp: 'Floor', kind: 'floor' }],
    previewColor: 0xd4a14a,
    addVerb: 'un-floor',
    cancelVerb: 'cancel un-floor',
    onChanged: () => notifyChanged(removeFloorDesignator),
  });
  designators.push(removeFloorDesignator);

  const installDesignator = new InstallDesignator({
    ...jobArgs,
    scene,
    onChanged: () => notifyChanged(installDesignator),
  });
  designators.push(installDesignator);

  const uninstallDesignator = new UninstallDesignator({
    ...jobArgs,
    scene,
    onChanged: () => notifyChanged(uninstallDesignator),
  });
  designators.push(uninstallDesignator);

  const cancelDesignator = new CancelDesignator({
    ...jobArgs,
    buildSiteInstancer,
    deconInstancers: [
      wallInstancer,
      roofInstancer,
      floorInstancer,
      furnaceInstancer,
      easelInstancer,
      stoveInstancer,
      bedInstancer,
      deconstructOverlay,
    ],
    onChanged: () => notifyChanged(cancelDesignator),
  });
  designators.push(cancelDesignator);

  const deactivateAllTools = () => {
    for (const d of designators) if (d.active) d.deactivate();
  };
  const isAnyToolActive = () => designators.some((d) => d.active);

  return {
    deactivateAllTools,
    isAnyToolActive,
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
  };
}
