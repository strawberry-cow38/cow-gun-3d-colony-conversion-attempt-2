/**
 * Per-RAF render composition: camera follow/FP, updates every instancer + overlay,
 * ticks HUD-side surfaces (portrait bar, item stack panel, furnace panel, build
 * tab), drives the clock readout, then fires the actual three.js render pass.
 *
 * Owns the render-side clock state (frame count, fps sampler, `startClock`,
 * `lastRenderClock`) so main.js doesn't have to thread mutable counters
 * around. `getFps` is exposed for the HUD.
 */

import { dayFractionOfTick, formatSimDate, formatSimTime, tickToSimDate } from '../sim/calendar.js';

/** @param {number} speed */
function speedIcon(speed) {
  if (speed === 0) return '⏸';
  // 6x reads as "▶▶▶▶" — same arrow alphabet as 1/2/3x so the player
  // doesn't read it as a distinct "turbo" tier, just "more arrows = faster".
  if (speed === 6) return '▶▶▶▶';
  return '▶'.repeat(speed);
}

/**
 * @param {{
 *   world: import('../ecs/world.js').World,
 *   tileGrid: import('../world/tileGrid.js').TileGrid,
 *   rooms: ReturnType<typeof import('../systems/rooms.js').createRooms>,
 *   state: import('./input.js').BootState,
 *   renderer: import('three').WebGLRenderer,
 *   scene: import('three').Scene,
 *   camera: import('three').PerspectiveCamera,
 *   sky: import('three').Object3D,
 *   rts: import('../render/rtsCamera.js').RtsCamera,
 *   fpCamera: import('../render/firstPersonCamera.js').FirstPersonCamera,
 *   audio: ReturnType<typeof import('../audio/audio.js').createAudio>,
 *   timeOfDay: ReturnType<typeof import('../world/timeOfDay.js').createTimeOfDay>,
 *   weather: ReturnType<typeof import('../world/weather.js').createWeather>,
 *   ambientScheduler: ReturnType<typeof import('../audio/ambientScheduler.js').createAmbientScheduler>,
 *   cowCamOverlay: ReturnType<typeof import('../render/cowCamOverlay.js').createCowCamOverlay>,
 *   draftBadge: ReturnType<typeof import('../render/draftBadge.js').createDraftBadge>,
 *   stressInstancer: ReturnType<typeof import('../render/stressInstancer.js').createStressInstancer> | null,
 *   instancers: ReturnType<typeof import('./setupInstancers.js').setupInstancers>,
 *   cowPortraitBar: { update: () => void },
 *   cowPanel: { update: () => void },
 *   itemStackPanel: { update: () => void },
 *   furnacePanel: { update: () => void },
 *   easelPanel: { update: () => void },
 *   stovePanel: { update: () => void },
 *   objectPanel: { update: () => void },
 *   buildTab: { update: () => void },
 *   clockEl: HTMLElement,
 *   getSpeed: () => number,
 *   getTick: () => number,
 *   updateHud: () => void,
 *   pruneStaleSelections: () => void,
 * }} opts
 */
export function createRenderFrame({
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
  ambientScheduler,
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
  objectPanel,
  buildTab,
  clockEl,
  getSpeed,
  getTick,
  updateHud,
  pruneStaleSelections,
}) {
  const {
    ambientParticles,
    cowInstancer,
    cowHitboxes,
    cowNameTags,
    cowThoughtBubbles,
    cowChatBubbles,
    selectionViz,
    itemSelectionViz,
    objectSelectionViz,
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

  let renderFrameCount = 0;
  let renderFpsSampleStart = performance.now();
  let measuredFps = 0;
  let lastRenderClock = performance.now();
  const startClock = performance.now();

  /** @param {number} alpha */
  const render = (alpha) => {
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
    const simTick = getTick() + (state.tickOffset ?? 0);
    timeOfDay.setT(dayFractionOfTick(simTick));
    weather.update(rdt, camera.position);
    ambientScheduler.update();
    cowCamOverlay.update(fpCamera, world);
    if (stressInstancer) stressInstancer.update(world, alpha);
    const tSec = (now - startClock) / 1000;
    const hiddenCowId = fpCamera.active ? fpCamera.cowId : null;
    cowInstancer.update(world, alpha, tSec, tileGrid, hiddenCowId);
    cowHitboxes.update(world);
    cowNameTags.update(world, camera, alpha);
    cowThoughtBubbles.update(world, camera, alpha);
    cowChatBubbles.update(world, camera, alpha, simTick);
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
    flowerInstancer.update(tileGrid);
    ambientParticles.update(world, rdt, timeOfDay.getSunLightPercent());
    furnaceInstancer.update(world, tileGrid);
    furnaceInstancer.updateGlow(tSec);
    furnaceEffects.update(world, tileGrid, rdt, tSec, camera);
    stationProgressBars.update(world, tileGrid, camera);
    stationSelectionViz.update(world, tileGrid, {
      selectedFurnaces: state.selectedFurnaces,
      selectedEasels: state.selectedEasels,
      selectedStoves: state.selectedStoves,
    });
    easelInstancer.update(world, tileGrid);
    stoveInstancer.update(world, tileGrid);
    paintingInstancer.update(world, tileGrid);
    wallArtInstancer.update(world, tileGrid);
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
    cowPanel.update();
    itemStackPanel.update();
    furnacePanel.update();
    easelPanel.update();
    stovePanel.update();
    objectPanel.update();
    buildTab.update();
    selectionViz.update(world, state.selectedCows, alpha, tSec, tileGrid);
    itemSelectionViz.update(world, tileGrid, state.selectedItems);
    objectSelectionViz.update(world, tileGrid, state.selectedObjects);
    objectHitboxes.update(world, tileGrid);
    const simDate = tickToSimDate(simTick);
    clockEl.textContent = `${formatSimTime(simDate)} ${speedIcon(getSpeed())}\n${formatSimDate(simDate)}`;
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
  };

  return {
    render,
    getFps: () => measuredFps,
  };
}
