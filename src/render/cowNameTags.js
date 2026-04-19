/**
 * Floating billboard name tags above each cow. One Sprite per cow, cached
 * by entity id and re-rendered only when the name changes.
 *
 * Text is drawn into a high-DPI canvas so glyphs stay crisp under bilinear
 * filtering even when the player zooms in past the sprite's typical screen
 * size. Sprites fade with camera distance and hide when the cow is behind
 * the camera.
 */

import * as THREE from 'three';
import { UNITS_PER_METER } from '../world/coords.js';

const TAG_HEIGHT_M = 0.35;
const HEAD_OFFSET_M = 1.15;
const FADE_START_M = 30;
const FADE_END_M = 120;

// Canvas height in pixels. Drawn large + downsampled so the text is sharp at
// typical RTS zoom and only mildly soft at extreme zoom-in.
const CANVAS_H = 192;
const FONT_PX = 128;
const PAD_X = 40;
const STROKE_PX = 10;
const FONT = `700 ${FONT_PX}px system-ui, -apple-system, 'Segoe UI', sans-serif`;

const _camPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _alive = new Set();

/** @type {CanvasRenderingContext2D | null} */
let _measureCtx = null;
function measureText(name) {
  if (!_measureCtx) {
    const c = document.createElement('canvas').getContext('2d');
    if (!c) return 0;
    c.font = FONT;
    _measureCtx = c;
  }
  return Math.ceil(_measureCtx.measureText(name).width);
}

/** @param {THREE.Scene} scene */
export function createCowNameTags(scene) {
  /**
   * @type {Map<number, { sprite: THREE.Sprite, material: THREE.SpriteMaterial, texture: THREE.CanvasTexture, name: string }>}
   */
  const tags = new Map();
  let visible = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} alpha
   */
  function update(world, camera, alpha) {
    if (!visible) return;
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camFwd);

    _alive.clear();
    for (const { id, components } of world.query(['Cow', 'Position', 'Brain'])) {
      _alive.add(id);
      const name = components.Brain.name ?? `#${id}`;
      let tag = tags.get(id);
      if (!tag || tag.name !== name) {
        if (tag) disposeTag(scene, tag);
        tag = makeTag(scene, name);
        tags.set(id, tag);
      }

      const pos = components.Position;
      const prev = world.get(id, 'PrevPosition') ?? pos;
      const x = prev.x + (pos.x - prev.x) * alpha;
      const y = prev.y + (pos.y - prev.y) * alpha;
      const z = prev.z + (pos.z - prev.z) * alpha;
      tag.sprite.position.set(x, y + HEAD_OFFSET_M * UNITS_PER_METER, z);

      _delta.set(x - _camPos.x, y - _camPos.y, z - _camPos.z);
      const distM = _delta.length() / UNITS_PER_METER;
      const facingDot = _delta.dot(_camFwd);

      let opacity = 1;
      if (facingDot <= 0) opacity = 0;
      else if (distM >= FADE_END_M) opacity = 0;
      else if (distM > FADE_START_M)
        opacity = 1 - (distM - FADE_START_M) / (FADE_END_M - FADE_START_M);

      tag.material.opacity = opacity;
      tag.sprite.visible = opacity > 0.01;
    }

    for (const [id, tag] of tags) {
      if (!_alive.has(id)) {
        disposeTag(scene, tag);
        tags.delete(id);
      }
    }
  }

  function dispose() {
    for (const tag of tags.values()) disposeTag(scene, tag);
    tags.clear();
  }

  /** @param {boolean} v */
  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    for (const tag of tags.values()) tag.sprite.visible = v;
  }

  return { update, dispose, setVisible };
}

/**
 * @param {THREE.Scene} scene
 * @param {string} name
 */
function makeTag(scene, name) {
  const canvasW = measureText(name) + PAD_X * 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = CANVAS_H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = STROKE_PX;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
  ctx.fillStyle = '#ffffff';
  ctx.strokeText(name, canvasW / 2, CANVAS_H / 2);
  ctx.fillText(name, canvasW / 2, CANVAS_H / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const sprite = new THREE.Sprite(material);
  const aspect = canvasW / CANVAS_H;
  const heightWorld = TAG_HEIGHT_M * UNITS_PER_METER;
  sprite.scale.set(heightWorld * aspect, heightWorld, 1);
  sprite.renderOrder = 10;
  scene.add(sprite);
  return { sprite, material, texture, name };
}

/**
 * @param {THREE.Scene} scene
 * @param {{ sprite: THREE.Sprite, material: THREE.SpriteMaterial, texture: THREE.CanvasTexture }} tag
 */
function disposeTag(scene, tag) {
  scene.remove(tag.sprite);
  tag.texture.dispose();
  tag.material.dispose();
}
