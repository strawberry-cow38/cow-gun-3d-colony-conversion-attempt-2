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
import { worldToTile } from '../world/coords.js';

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
    ambientParticles,
    treeInstancer,
    boulderInstancer,
    wallInstancer,
    roofInstancer,
    floorInstancer,
    flowerInstancer,
    furnaceInstancer,
    easelInstancer,
    paintingInstancer,
    wallArtInstancer,
    buildSiteInstancer,
    deconstructOverlay,
    roomOverlay,
    itemInstancer,
    itemSelectionViz,
    cropInstancer,
    tilledOverlay,
    roofCollapseParticles,
  } = instancers;

  /**
   * Evict only the cached paths that actually touched the changed tile (or its
   * 3x3 corner-cut neighborhood). A full `pathCache.clear()` used to nuke all
   * ~2048 entries on every chop/mine/wall, stuttering cows mid-route for
   * unrelated map changes. `worldToTile` already clamps OOB to (-1, -1); bail
   * in that case rather than invalidating a bogus tile.
   *
   * @param {{x:number,y:number,z:number}} pos
   */
  const invalidatePathCacheAt = (pos) => {
    const { i, j } = worldToTile(pos.x, pos.z, tileGrid.W, tileGrid.H);
    if (i < 0) return;
    pathCache.invalidateTile(i, j);
  };

  return {
    /** @param {{x:number,y:number,z:number}} pos */
    onWorldChopComplete(pos) {
      treeInstancer.markDirty();
      itemInstancer.markDirty();
      invalidatePathCacheAt(pos);
      audio.playAt('chop', pos);
    },
    /** @param {{x:number,y:number,z:number}} pos */
    onWorldMineComplete(pos) {
      boulderInstancer.markDirty();
      itemInstancer.markDirty();
      invalidatePathCacheAt(pos);
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
      flowerInstancer.markDirty();
      ambientParticles.markFlowersDirty();
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
      flowerInstancer.markDirty();
      ambientParticles.markFlowersDirty();
      furnaceInstancer.markDirty();
      easelInstancer.markDirty();
      buildSiteInstancer.markDirty();
      deconstructOverlay.markDirty();
      // Walls/doors/furnaces/easels all change walkability (stations block
      // their tile via the generic occupancy bitmap; door deconstruct/build
      // flips the door bit). Torches/floors/roofs stay passable, so skip the
      // cache invalidation + topology rebuild for them — that keeps the
      // stutter off when the player drops a row of torches or floors.
      if (kind === 'wall' || kind === 'door' || kind === 'furnace' || kind === 'easel') {
        invalidatePathCacheAt(pos);
        scheduler.dirty.mark('topology');
      }
      audio.playAt('hammer', pos);
    },
    onRoomsRebuilt() {
      roomOverlay.markDirty();
      // Collapse any roofs that lost their support chain (a wall got demolished
      // out from under them). Fires BEFORE auto-roof so the auto-roofer doesn't
      // immediately re-queue blueprints for tiles that are about to be torn down.
      // Note: roof collapse doesn't touch walkability (roofs are a purely
      // visual/room-enclosure layer), so no path-cache invalidation here —
      // the wall deconstruct that triggered this cascade already invalidated
      // its own tile via onWorldBuildComplete(kind='wall').
      const { collapsed, supported } = runRoofCollapse(world, tileGrid);
      for (const pos of collapsed) {
        roofCollapseParticles.burst(pos.x, pos.y, pos.z);
        audio.playAt('chop', pos);
      }
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
      paintingInstancer.markDirty();
      wallArtInstancer.markDirty();
      buildSiteInstancer.markDirty();
    },
  };
}
