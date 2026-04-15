/**
 * Construct every tile-painting designator (chop, mine, build, deconstruct, …).
 *
 * The designators are mutually exclusive: activating one deactivates every
 * other via the shared `deactivateOthers` walk. We push each one into the
 * list as it's built; `onStateChanged` only fires from event handlers that
 * can't run before the whole list has been populated, so the mid-construction
 * list is safe to reference from the callbacks.
 */

import {
  BuildDesignator,
  DOOR_DESIGNATOR_CONFIG,
  FLOOR_DESIGNATOR_CONFIG,
  FURNACE_DESIGNATOR_CONFIG,
  ROOF_DESIGNATOR_CONFIG,
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
import { MineDesignator } from '../render/mineDesignator.js';
import { StockpileDesignator } from '../render/stockpileDesignator.js';

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   camera: import('three').PerspectiveCamera,
 *   scene: import('three').Scene,
 *   audio: ReturnType<typeof import('../audio/audio.js').createAudio>,
 *   tileGrid: import('../world/tileGrid.js').TileGrid,
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
  /** @param {{ active: boolean, deactivate: () => void }} self */
  const deactivateOthers = (self) => {
    if (!self.active) return;
    for (const d of designators) if (d !== self) d.deactivate();
  };
  /** @param {{ active: boolean, deactivate: () => void }} d */
  const onChanged = (d) => {
    deactivateOthers(d);
    updateHud();
  };

  const chopDesignator = new ChopDesignator(
    canvas,
    camera,
    tileMesh,
    tileGrid,
    treeInstancer,
    world,
    jobBoard,
    scene,
    () => onChanged(chopDesignator),
    audio,
  );
  designators.push(chopDesignator);

  const cutDesignator = new CutDesignator(
    canvas,
    camera,
    tileMesh,
    tileGrid,
    treeInstancer,
    cropInstancer,
    world,
    jobBoard,
    scene,
    () => onChanged(cutDesignator),
    audio,
  );
  designators.push(cutDesignator);

  const mineDesignator = new MineDesignator(
    canvas,
    camera,
    tileMesh,
    tileGrid,
    boulderInstancer,
    world,
    jobBoard,
    scene,
    () => onChanged(mineDesignator),
    audio,
  );
  designators.push(mineDesignator);

  const stockpileDesignator = new StockpileDesignator(
    canvas,
    camera,
    tileMesh,
    tileGrid,
    stockpileOverlay,
    scene,
    () => onChanged(stockpileDesignator),
    audio,
  );
  designators.push(stockpileDesignator);

  const farmZoneDesignator = new FarmZoneDesignator(
    canvas,
    camera,
    tileMesh,
    tileGrid,
    farmZoneOverlay,
    scene,
    () => onChanged(farmZoneDesignator),
    audio,
  );
  designators.push(farmZoneDesignator);

  const wallDesignator = new BuildDesignator(
    WALL_DESIGNATOR_CONFIG,
    canvas,
    camera,
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    buildSiteInstancer,
    scene,
    () => onChanged(wallDesignator),
    audio,
  );
  designators.push(wallDesignator);

  const doorDesignator = new BuildDesignator(
    DOOR_DESIGNATOR_CONFIG,
    canvas,
    camera,
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    buildSiteInstancer,
    scene,
    () => onChanged(doorDesignator),
    audio,
    deconstructOverlay,
  );
  designators.push(doorDesignator);

  const torchDesignator = new BuildDesignator(
    TORCH_DESIGNATOR_CONFIG,
    canvas,
    camera,
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    buildSiteInstancer,
    scene,
    () => onChanged(torchDesignator),
    audio,
  );
  designators.push(torchDesignator);

  const wallTorchDesignator = new BuildDesignator(
    WALL_TORCH_DESIGNATOR_CONFIG,
    canvas,
    camera,
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    buildSiteInstancer,
    scene,
    () => onChanged(wallTorchDesignator),
    audio,
  );
  designators.push(wallTorchDesignator);

  const roofDesignator = new BuildDesignator(
    ROOF_DESIGNATOR_CONFIG,
    canvas,
    camera,
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    buildSiteInstancer,
    scene,
    () => onChanged(roofDesignator),
    audio,
  );
  designators.push(roofDesignator);

  const floorDesignator = new BuildDesignator(
    FLOOR_DESIGNATOR_CONFIG,
    canvas,
    camera,
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    buildSiteInstancer,
    scene,
    () => onChanged(floorDesignator),
    audio,
  );
  designators.push(floorDesignator);

  const furnaceDesignator = new BuildDesignator(
    FURNACE_DESIGNATOR_CONFIG,
    canvas,
    camera,
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    buildSiteInstancer,
    scene,
    () => onChanged(furnaceDesignator),
    audio,
  );
  designators.push(furnaceDesignator);

  const ignoreRoofDesignator = new IgnoreRoofDesignator(
    canvas,
    camera,
    tileMesh,
    tileGrid,
    ignoreRoofOverlay,
    scene,
    () => onChanged(ignoreRoofDesignator),
    audio,
  );
  designators.push(ignoreRoofDesignator);

  const deconstructDesignator = new DeconstructDesignator(
    canvas,
    camera,
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    [wallInstancer, floorInstancer, furnaceInstancer, deconstructOverlay],
    scene,
    () => onChanged(deconstructDesignator),
    audio,
  );
  designators.push(deconstructDesignator);

  const removeRoofDesignator = new DeconstructDesignator(
    canvas,
    camera,
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    [roofInstancer, deconstructOverlay, ignoreRoofOverlay],
    scene,
    () => onChanged(removeRoofDesignator),
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
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    [floorInstancer, deconstructOverlay],
    scene,
    () => onChanged(removeFloorDesignator),
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
    tileMesh,
    tileGrid,
    world,
    jobBoard,
    buildSiteInstancer,
    [wallInstancer, roofInstancer, floorInstancer, furnaceInstancer, deconstructOverlay],
    scene,
    () => onChanged(cancelDesignator),
    audio,
  );
  designators.push(cancelDesignator);

  return {
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
  };
}
