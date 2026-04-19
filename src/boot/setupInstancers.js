/**
 * Construct every renderer/overlay the main loop pokes at runtime.
 *
 * Returned as a single bag so main.js can destructure without the import
 * block doubling in size; capacities that depend on the grid size (walls,
 * roofs, floors, overlays sized `gridW * gridH`) are threaded through here
 * instead of being hardcoded twice.
 */

import { createAmbientParticles } from '../render/ambientParticles.js';
import { createBedInstancer } from '../render/bedInstancer.js';
import { createBedNameTags } from '../render/bedNameTags.js';
import { createBoulderInstancer } from '../render/boulderInstancer.js';
import { createBuildSiteInstancer } from '../render/buildSiteInstancer.js';
import { createBushInstancer } from '../render/bushInstancer.js';
import { createCowChatBubbles } from '../render/cowChatBubbles.js';
import { createCowHitboxes } from '../render/cowHitboxes.js';
import { createCowInstancer } from '../render/cowInstancer.js';
import { createCowNameTags } from '../render/cowNameTags.js';
import { createCowThoughtBubbles } from '../render/cowThoughtBubbles.js';
import { createCropInstancer } from '../render/cropInstancer.js';
import { createCuttableMarkerInstancer } from '../render/cuttableMarkerInstancer.js';
import { createDeconstructOverlay } from '../render/deconstructOverlay.js';
import { createDoorInstancer } from '../render/doorInstancer.js';
import { createDropShadows } from '../render/dropShadows.js';
import { createEaselInstancer } from '../render/easelInstancer.js';
import { createFarmZoneOverlay } from '../render/farmZoneOverlay.js';
import { createFloorInstancer } from '../render/floorInstancer.js';
import { createFlowerInstancer } from '../render/flowerInstancer.js';
import { createFurnaceEffects } from '../render/furnaceEffects.js';
import { createFurnaceInstancer } from '../render/furnaceInstancer.js';
import { createIgnoreRoofOverlay } from '../render/ignoreRoofOverlay.js';
import { createItemHitboxes } from '../render/itemHitboxes.js';
import { createItemInstancer } from '../render/itemInstancer.js';
import { createItemLabels } from '../render/itemLabels.js';
import { createItemSelectionViz } from '../render/itemSelectionViz.js';
import { createObjectHitboxes } from '../render/objectHitboxes.js';
import { createObjectSelectionViz } from '../render/objectSelectionViz.js';
import { createPaintingInstancer } from '../render/paintingInstancer.js';
import { createPickTileOverlay } from '../render/pickTileOverlay.js';
import { createRoofCollapseParticles } from '../render/roofCollapseParticles.js';
import { createRoofInstancer } from '../render/roofInstancer.js';
import { createRoomOverlay } from '../render/roomOverlay.js';
import { createSelectionViz } from '../render/selectionViz.js';
import { createStairInstancer } from '../render/stairInstancer.js';
import { createStationProgressBars } from '../render/stationProgressBars.js';
import { createStationSelectionViz } from '../render/stationSelectionViz.js';
import { createStockpileOverlay } from '../render/stockpileOverlay.js';
import { createStoveInstancer } from '../render/stoveInstancer.js';
import { createTilledOverlay } from '../render/tilledOverlay.js';
import { createTorchInstancer } from '../render/torchInstancer.js';
import { createTreeInstancer } from '../render/treeInstancer.js';
import { createWakeParticles } from '../render/wakeParticles.js';
import { createWallArtInstancer } from '../render/wallArtInstancer.js';
import { createWallInstancer } from '../render/wallInstancer.js';

/**
 * @param {{
 *   scene: import('three').Scene,
 *   audio: ReturnType<typeof import('../audio/audio.js').createAudio>,
 *   gridW: number,
 *   gridH: number,
 *   tileGrid: import('../world/tileGrid.js').TileGrid,
 * }} opts
 */
export function setupInstancers({ scene, audio, gridW, gridH, tileGrid }) {
  const tiles = gridW * gridH;
  return {
    ambientParticles: createAmbientParticles(scene, tileGrid),
    cowInstancer: createCowInstancer(scene, 256),
    cowHitboxes: createCowHitboxes(scene, 256),
    cowNameTags: createCowNameTags(scene),
    cowThoughtBubbles: createCowThoughtBubbles(scene),
    cowChatBubbles: createCowChatBubbles(scene),
    selectionViz: createSelectionViz(scene),
    itemSelectionViz: createItemSelectionViz(scene),
    objectSelectionViz: createObjectSelectionViz(scene),
    objectHitboxes: createObjectHitboxes(scene, tiles + 4096),
    treeInstancer: createTreeInstancer(scene, 2048),
    boulderInstancer: createBoulderInstancer(scene, 4096),
    bushInstancer: createBushInstancer(scene, 4096),
    wallInstancer: createWallInstancer(scene, 2048),
    doorInstancer: createDoorInstancer(scene, 512, audio),
    dropShadows: createDropShadows(scene, 1536),
    torchInstancer: createTorchInstancer(scene, 512),
    roofInstancer: createRoofInstancer(scene, tiles),
    roofCollapseParticles: createRoofCollapseParticles(scene),
    floorInstancer: createFloorInstancer(scene, tiles),
    flowerInstancer: createFlowerInstancer(scene, 2048),
    furnaceInstancer: createFurnaceInstancer(scene, 256),
    furnaceEffects: createFurnaceEffects(scene),
    stationProgressBars: createStationProgressBars(scene),
    stationSelectionViz: createStationSelectionViz(scene),
    easelInstancer: createEaselInstancer(scene, 64),
    stoveInstancer: createStoveInstancer(scene, 32),
    bedInstancer: createBedInstancer(scene, 64),
    stairInstancer: createStairInstancer(scene, 128),
    bedNameTags: createBedNameTags(scene),
    paintingInstancer: createPaintingInstancer(scene, 128),
    wallArtInstancer: createWallArtInstancer(scene, 128),
    buildSiteInstancer: createBuildSiteInstancer(scene, 1024),
    cropInstancer: createCropInstancer(scene, 1024),
    cuttableMarkerInstancer: createCuttableMarkerInstancer(scene, 256),
    itemInstancer: createItemInstancer(scene, 1024),
    itemHitboxes: createItemHitboxes(scene, 1024),
    itemLabels: createItemLabels(scene),
    stockpileOverlay: createStockpileOverlay(scene, tiles),
    farmZoneOverlay: createFarmZoneOverlay(scene, tiles),
    tilledOverlay: createTilledOverlay(scene, tiles),
    roomOverlay: createRoomOverlay(scene, tiles),
    ignoreRoofOverlay: createIgnoreRoofOverlay(scene, tiles),
    deconstructOverlay: createDeconstructOverlay(scene, tiles),
    pickTileOverlay: createPickTileOverlay(scene),
    wakeParticles: createWakeParticles(scene),
  };
}
