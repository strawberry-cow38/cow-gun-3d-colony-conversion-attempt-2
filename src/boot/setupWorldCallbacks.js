/**
 * Wire the brain's per-event callbacks to the renderer/audio side effects.
 *
 * The brain doesn't know or care about instancers — it just calls these
 * hooks when a job completes. Each hook poke the right instancer dirty
 * flags, plays the matching audio cue, and (for topology-changing events)
 * invalidates the path cache + marks the scheduler's topology dirty bit.
 *
 * Rooms rebuild is its own pipeline: the rooms system flood-fills, then
 * calls `onRoomsRebuilt`, which runs roof collapse + auto-roof atomically
 * so the next tick sees a consistent world.
 */

import { runAutoRoof } from '../systems/autoRoof.js';
import { runRoofCollapse } from '../systems/roofCollapse.js';

/**
 * @param {{
 *   world: import('../ecs/world.js').World,
 *   tileGrid: import('../world/tileGrid.js').TileGrid,
 *   pathCache: import('../sim/pathfinding.js').PathCache,
 *   jobBoard: import('../jobs/board.js').JobBoard,
 *   scheduler: import('../ecs/schedule.js').Scheduler,
 *   rooms: ReturnType<typeof import('../systems/rooms.js').createRooms>,
 *   audio: ReturnType<typeof import('../audio/audio.js').createAudio>,
 *   instancers: ReturnType<typeof import('./setupInstancers.js').setupInstancers>,
 * }} opts
 */
export function setupWorldCallbacks({
  world,
  tileGrid,
  pathCache,
  jobBoard,
  scheduler,
  rooms,
  audio,
  instancers,
}) {
  const {
    treeInstancer,
    boulderInstancer,
    wallInstancer,
    roofInstancer,
    floorInstancer,
    furnaceInstancer,
    buildSiteInstancer,
    deconstructOverlay,
    roomOverlay,
    itemInstancer,
    itemSelectionViz,
    cropInstancer,
    tilledOverlay,
    roofCollapseParticles,
  } = instancers;

  return {
    /** @param {{x:number,y:number,z:number}} pos */
    onWorldChopComplete(pos) {
      treeInstancer.markDirty();
      itemInstancer.markDirty();
      pathCache.clear();
      audio.playAt('chop', pos);
    },
    /** @param {{x:number,y:number,z:number}} pos */
    onWorldMineComplete(pos) {
      boulderInstancer.markDirty();
      itemInstancer.markDirty();
      pathCache.clear();
      audio.playAt('chop', pos);
    },
    /** @param {{x:number,y:number,z:number}} pos */
    onWorldCowEat(pos) {
      audio.playAt('munch', pos);
    },
    /** @param {{x:number,y:number,z:number}} pos */
    onWorldCowStep(pos) {
      audio.playAt('footfall', pos);
    },
    /** @param {{x:number,y:number,z:number}} pos */
    onWorldCowHammer(pos) {
      audio.playAt('hammer', pos);
    },
    /** @param {{x:number,y:number,z:number}} pos */
    onWorldTillComplete(pos) {
      tilledOverlay.markDirty();
      audio.playAt('chop', pos);
    },
    /** @param {{x:number,y:number,z:number}} pos */
    onWorldPlantComplete(pos) {
      cropInstancer.markDirty();
      audio.playAt('chop', pos);
    },
    /** @param {{x:number,y:number,z:number}} pos */
    onWorldHarvestComplete(pos) {
      cropInstancer.markDirty();
      itemInstancer.markDirty();
      audio.playAt('chop', pos);
    },
    /**
     * @param {{x:number,y:number,z:number}} pos
     * @param {string} kind
     */
    onWorldBuildComplete(pos, kind) {
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
    },
    onRoomsRebuilt() {
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
    },
    onWorldItemChange() {
      itemInstancer.markDirty();
      itemSelectionViz.markDirty();
      buildSiteInstancer.markDirty();
    },
  };
}
