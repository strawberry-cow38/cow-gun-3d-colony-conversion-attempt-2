/**
 * World-space progress bars above active furnaces. Two camera-facing Sprites
 * per active furnace: a dark background and an orange fill whose x-scale
 * tracks `1 - workTicksRemaining / recipe.workTicks`. Sprites use `center`
 * at the left edge so the fill extends rightward from a fixed origin rather
 * than scaling from its middle.
 *
 * Idle furnaces get no sprite — they're created on craft start and torn
 * down when `activeBillId` flips back to 0 or the furnace despawns.
 */

import * as THREE from 'three';
import { UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { RECIPES } from '../world/recipes.js';
import { FURNACE_HEIGHT } from './furnaceInstancer.js';

const BAR_WIDTH = 0.9 * UNITS_PER_METER;
const BAR_HEIGHT = 0.14 * UNITS_PER_METER;
const BAR_Y_OFFSET = FURNACE_HEIGHT + 0.95 * UNITS_PER_METER;
const FADE_START = 25 * UNITS_PER_METER;
const FADE_END = 110 * UNITS_PER_METER;

const _camPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _delta = new THREE.Vector3();

/**
 * @param {THREE.Scene} scene
 */
export function createFurnaceProgressBars(scene) {
  /**
   * @type {Map<number, {
   *   bgSprite: THREE.Sprite,
   *   bgMat: THREE.SpriteMaterial,
   *   fillSprite: THREE.Sprite,
   *   fillMat: THREE.SpriteMaterial,
   * }>}
   */
  const bars = new Map();
  let visible = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {import('../world/tileGrid.js').TileGrid} grid
   * @param {THREE.PerspectiveCamera} camera
   */
  function update(world, grid, camera) {
    if (!visible) return;
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camFwd);

    const alive = new Set();
    for (const { id, components } of world.query(['Furnace', 'TileAnchor', 'Bills'])) {
      const furnace = components.Furnace;
      if (furnace.activeBillId <= 0) continue;
      const bill = components.Bills.list.find((b) => b.id === furnace.activeBillId);
      if (!bill) continue;
      const recipe = RECIPES[bill.recipeId];
      if (!recipe || recipe.workTicks <= 0) continue;

      alive.add(id);
      let bar = bars.get(id);
      if (!bar) {
        bar = makeBar(scene);
        bars.set(id, bar);
      }

      const a = components.TileAnchor;
      const w = tileToWorld(a.i, a.j, grid.W, grid.H);
      const y = grid.getElevation(a.i, a.j) + BAR_Y_OFFSET;
      bar.bgSprite.position.set(w.x, y, w.z);
      bar.fillSprite.position.set(w.x, y, w.z);

      const progress = Math.max(0, Math.min(1, 1 - furnace.workTicksRemaining / recipe.workTicks));
      bar.fillSprite.scale.set(BAR_WIDTH * progress, BAR_HEIGHT, 1);

      _delta.set(w.x - _camPos.x, y - _camPos.y, w.z - _camPos.z);
      const dist = _delta.length();
      const facingDot = _delta.dot(_camFwd);
      let opacity = 1;
      if (facingDot <= 0) opacity = 0;
      else if (dist >= FADE_END) opacity = 0;
      else if (dist > FADE_START) opacity = 1 - (dist - FADE_START) / (FADE_END - FADE_START);

      bar.bgMat.opacity = opacity * 0.85;
      bar.fillMat.opacity = opacity;
      bar.bgSprite.visible = opacity > 0.01;
      bar.fillSprite.visible = opacity > 0.01 && progress > 0;
    }

    for (const [id, bar] of bars) {
      if (!alive.has(id)) {
        disposeBar(scene, bar);
        bars.delete(id);
      }
    }
  }

  /** @param {boolean} v */
  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    for (const bar of bars.values()) {
      bar.bgSprite.visible = v;
      bar.fillSprite.visible = v;
    }
  }

  return { update, setVisible };
}

/**
 * @param {THREE.Scene} scene
 */
function makeBar(scene) {
  const bgMat = new THREE.SpriteMaterial({
    color: 0x181a1f,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const bgSprite = new THREE.Sprite(bgMat);
  // Anchor left-edge so scale.x changes extend rightward from a fixed x.
  bgSprite.center.set(0, 0.5);
  bgSprite.scale.set(BAR_WIDTH, BAR_HEIGHT, 1);
  bgSprite.renderOrder = 11;
  scene.add(bgSprite);

  const fillMat = new THREE.SpriteMaterial({
    color: 0xff7a28,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const fillSprite = new THREE.Sprite(fillMat);
  fillSprite.center.set(0, 0.5);
  fillSprite.scale.set(0, BAR_HEIGHT, 1);
  fillSprite.renderOrder = 12;
  scene.add(fillSprite);

  return { bgSprite, bgMat, fillSprite, fillMat };
}

/**
 * @param {THREE.Scene} scene
 * @param {{ bgSprite: THREE.Sprite, bgMat: THREE.SpriteMaterial, fillSprite: THREE.Sprite, fillMat: THREE.SpriteMaterial }} bar
 */
function disposeBar(scene, bar) {
  scene.remove(bar.bgSprite);
  scene.remove(bar.fillSprite);
  bar.bgMat.dispose();
  bar.fillMat.dispose();
}
