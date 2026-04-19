/**
 * Per-RAF render composition: camera follow/FP, updates every instancer + overlay,
 * ticks HUD-side surfaces (portrait bar, item stack panel, furnace panel, build
 * tab), drives the clock readout, then fires the actual three.js render pass.
 *
 * Owns the render-side clock state (frame count, fps sampler, `startClock`,
 * `lastRenderClock`) so main.js doesn't have to thread mutable counters
 * around. `getFps` is exposed for the HUD.
 */

import * as THREE from 'three';
import { dayFractionOfTick, formatSimDate, formatSimTime, tickToSimDate } from '../sim/calendar.js';
import { worldToTileClamp } from '../world/coords.js';
import { BIOME } from '../world/tileGrid.js';

// Scratch frustum + matrix for the "terrain chunks visible" HUD readout.
// Reused each frame so the counter doesn't allocate.
const _chunkFrustum = new THREE.Frustum();
const _chunkProjView = new THREE.Matrix4();

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
 *   sun: import('three').DirectionalLight,
 *   sky: import('three').Object3D,
 *   rts: import('../render/rtsCamera.js').RtsCamera,
 *   fpCamera: import('../render/firstPersonCamera.js').FirstPersonCamera,
 *   audio: ReturnType<typeof import('../audio/audio.js').createAudio>,
 *   timeOfDay: ReturnType<typeof import('../world/timeOfDay.js').createTimeOfDay>,
 *   weather: ReturnType<typeof import('../world/weather.js').createWeather>,
 *   cowCamOverlay: ReturnType<typeof import('../render/cowCamOverlay.js').createCowCamOverlay>,
 *   draftBadge: ReturnType<typeof import('../render/draftBadge.js').createDraftBadge>,
 *   stressInstancer: ReturnType<typeof import('../render/stressInstancer.js').createStressInstancer> | null,
 *   stockpileZones: import('../systems/stockpileZones.js').StockpileZones,
 *   farmZones: import('../systems/farmZones.js').FarmZones,
 *   instancers: ReturnType<typeof import('./setupInstancers.js').setupInstancers>,
 *   cowPortraitBar: { update: () => void },
 *   cowPanel: { update: () => void },
 *   itemStackPanel: { update: () => void },
 *   furnacePanel: { update: () => void },
 *   easelPanel: { update: () => void },
 *   stovePanel: { update: () => void },
 *   bedPanel: { update: () => void },
 *   stockpilePanel: { update: () => void },
 *   farmPanel: { update: () => void },
 *   objectPanel: { update: () => void },
 *   buildTab: { update: () => void },
 *   workTab: { update: () => void },
 *   clockEl: HTMLElement,
 *   getSpeed: () => number,
 *   getTick: () => number,
 *   getTps: () => number,
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
  stockpileZones,
  farmZones,
  instancers,
  cowPortraitBar,
  cowPanel,
  itemStackPanel,
  furnacePanel,
  easelPanel,
  stovePanel,
  bedPanel,
  stockpilePanel,
  farmPanel,
  objectPanel,
  buildTab,
  workTab,
  clockEl,
  getSpeed,
  getTick,
  getTps,
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
    bushInstancer,
    wallInstancer,
    doorInstancer,
    dropShadows,
    torchInstancer,
    roofInstancer,
    roofCollapseParticles,
    wakeParticles,
    floorInstancer,
    flowerInstancer,
    furnaceInstancer,
    furnaceEffects,
    stationProgressBars,
    stationSelectionViz,
    easelInstancer,
    stoveInstancer,
    bedInstancer,
    stairInstancer,
    bedNameTags,
    paintingInstancer,
    wallArtInstancer,
    buildSiteInstancer,
    cropInstancer,
    cuttableMarkerInstancer,
    itemInstancer,
    itemHitboxes,
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
  // Sun starts with a fixed world-space offset from origin; preserve that
  // direction each frame by rebasing off the origin instead of accumulating.
  const sunBaseX = sun.position.x;
  const sunBaseY = sun.position.y;
  const sunBaseZ = sun.position.z;
  /** Last wall-clock time we spawned a wake burst for each cow id. */
  /** @type {Map<number, number>} */
  const lastWakeAt = new Map();
  const WAKE_INTERVAL = 0.18;
  const WAKE_MIN_SPEED_SQ = 0.25;

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
    // Sun follows camera focus so its directional lighting angle stays
    // consistent; shadow map is disabled (see scene.js) so we only need to
    // reposition the light for its Lambert contribution.
    const fx = fpCamera.active ? camera.position.x : rts.focus.x;
    const fz = fpCamera.active ? camera.position.z : rts.focus.z;
    sun.target.position.set(fx, 0, fz);
    sun.position.set(sunBaseX + fx, sunBaseY, sunBaseZ + fz);
    weather.update(rdt, camera.position);
    cowCamOverlay.update(fpCamera, world);
    if (stressInstancer) stressInstancer.update(world, alpha);
    const tSec = (now - startClock) / 1000;
    const hiddenCowId = fpCamera.active ? fpCamera.cowId : null;
    cowInstancer.update(world, alpha, tSec, tileGrid, hiddenCowId);
    cowHitboxes.update(world, alpha, tileGrid);
    cowNameTags.update(world, camera, alpha);
    bedNameTags.update(world, tileGrid, camera);
    cowThoughtBubbles.update(world, camera, alpha);
    cowChatBubbles.update(world, camera, alpha, simTick);
    draftBadge.update(world, tSec);
    treeInstancer.update(world, tileGrid);
    treeInstancer.updateMarkers(world, tileGrid, tSec);
    boulderInstancer.update(world, tileGrid);
    boulderInstancer.updateMarkers(world, tileGrid, tSec);
    bushInstancer.update(world, tileGrid);
    wallInstancer.update(world, tileGrid);
    doorInstancer.update(world, tileGrid);
    torchInstancer.update(world, tileGrid, tSec, camera);
    roofInstancer.update(world, tileGrid);
    floorInstancer.update(world, tileGrid);
    flowerInstancer.update(tileGrid);
    ambientParticles.update(world, rdt, timeOfDay.getSunLightPercent());
    furnaceInstancer.update(world, tileGrid);
    furnaceInstancer.updateGlow(tSec);
    furnaceEffects.update(world, tileGrid, rdt);
    stationProgressBars.update(world, tileGrid, camera);
    stationSelectionViz.update(world, tileGrid, {
      selectedFurnaces: state.selectedFurnaces,
      selectedEasels: state.selectedEasels,
      selectedStoves: state.selectedStoves,
      selectedBeds: state.selectedBeds,
      selectedStairs: state.selectedStairs,
    });
    easelInstancer.update(world, tileGrid);
    stoveInstancer.update(world, tileGrid);
    bedInstancer.update(world, tileGrid);
    stairInstancer.update(world, tileGrid);
    paintingInstancer.update(world, tileGrid);
    wallArtInstancer.update(world, tileGrid);
    roofCollapseParticles.update(rdt);
    // Water wakes: burst once every ~0.18s per cow that's wading (in
    // SHALLOW_WATER) and actually moving. `lastWakeAt` tracks the per-cow
    // timestamp so fast cows don't spam bursts every frame.
    for (const { id, components } of world.query(['Cow', 'Position', 'Velocity'])) {
      const p = components.Position;
      const v = components.Velocity;
      if (v.x * v.x + v.z * v.z < WAKE_MIN_SPEED_SQ) continue;
      const t = worldToTileClamp(p.x, p.z, tileGrid.W, tileGrid.H);
      if (tileGrid.biome[tileGrid.idx(t.i, t.j)] !== BIOME.SHALLOW_WATER) continue;
      const last = lastWakeAt.get(id) ?? 0;
      if (tSec - last < WAKE_INTERVAL) continue;
      lastWakeAt.set(id, tSec);
      wakeParticles.burst(p.x, p.z);
    }
    wakeParticles.update(rdt);
    if (state.waterMesh) {
      const mat =
        /** @type {THREE.Material & { userData: { shader?: { uniforms: { uTime: { value: number } } } } }} */ (
          state.waterMesh.material
        );
      const shader = mat.userData.shader;
      if (shader) shader.uniforms.uTime.value = tSec;
    }
    buildSiteInstancer.update(world, tileGrid);
    cropInstancer.update(world, tileGrid);
    cuttableMarkerInstancer.updateMarkers(world, tileGrid, tSec);
    itemInstancer.update(world, tileGrid);
    itemLabels.update(world, camera, tileGrid);
    dropShadows.update(world, tileGrid, alpha);
    stockpileOverlay.update(tileGrid, stockpileZones, state.selectedZoneId);
    farmZoneOverlay.update(tileGrid, farmZones, state.selectedFarmZoneId);
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
    bedPanel.update();
    stockpilePanel.update();
    farmPanel.update();
    objectPanel.update();
    buildTab.update();
    workTab.update();
    selectionViz.update(world, state.selectedCows, alpha, tSec, tileGrid);
    itemSelectionViz.update(world, tileGrid, state.selectedItems);
    objectSelectionViz.update(world, tileGrid, state.selectedObjects);
    objectHitboxes.update(world, tileGrid, { roofsVisible: state.roofsVisible !== false });
    itemHitboxes.update(world, tileGrid);
    const simDate = tickToSimDate(simTick);
    // Terrain chunk visibility: frustum-test each chunk mesh's bounding sphere
    // and surface "visible / total" on the clock readout. A healthy chunked
    // terrain shows <<total while the camera is looking at any single part of
    // the map; if this stays pinned at total/total, chunking isn't helping.
    let terrainVisible = 0;
    let terrainTotal = 0;
    const terrainGroup = state.tileMesh;
    if (terrainGroup) {
      _chunkProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _chunkFrustum.setFromProjectionMatrix(_chunkProjView);
      for (const child of terrainGroup.children) {
        // Each child is a chunk Group (tops InstancedMesh + optional cliffs
        // Mesh). Frustum.intersectsObject requires a Mesh — test the tops
        // instance mesh, whose bounding sphere covers every tile in the
        // chunk extent (cliffs live within the same XZ rect and only drop
        // slightly below the lowest top instance).
        const tops = child.children[0];
        if (!tops) continue;
        terrainTotal++;
        if (_chunkFrustum.intersectsObject(tops)) terrainVisible++;
      }
    }
    clockEl.textContent = `${formatSimTime(simDate)} ${speedIcon(getSpeed())}\n${formatSimDate(simDate)}\n${measuredFps.toFixed(0)} fps  ${getTps().toFixed(0)} tps\nchunks: ${terrainVisible}/${terrainTotal}`;
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
