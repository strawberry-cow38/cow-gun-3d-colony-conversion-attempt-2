/**
 * Floating billboard labels above every Item in the world. Shows
 * "kind count/capacity". One Sprite per item entity, cached by id.
 *
 * Text regenerates only when it changes — a full stack hanging out at 50/50
 * for thousands of ticks costs zero canvas work after the first frame.
 *
 * Visibility is gated by the debug flag (P) in the HUD, so in non-debug play
 * the world isn't flooded with floating text.
 */

import * as THREE from 'three';
import { UNITS_PER_METER } from '../world/coords.js';

const TAG_OFFSET = 1.1 * UNITS_PER_METER;
const TAG_HEIGHT_WORLD = 0.55 * UNITS_PER_METER;
const FADE_START = 20 * UNITS_PER_METER;
const FADE_END = 90 * UNITS_PER_METER;

const _camPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _delta = new THREE.Vector3();

/**
 * @param {THREE.Scene} scene
 */
export function createItemLabels(scene) {
  /**
   * @type {Map<number, { sprite: THREE.Sprite, material: THREE.SpriteMaterial, texture: THREE.CanvasTexture, text: string }>}
   */
  const tags = new Map();
  let visible = true;

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('../world/tileGrid.js').TileGrid} grid
   */
  function update(world, camera, grid) {
    if (!visible) return;
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camFwd);

    const alive = new Set();
    for (const { id, components } of world.query(['Item', 'TileAnchor', 'Position'])) {
      alive.add(id);
      const item = components.Item;
      const text = `${item.kind} ${item.count}/${item.capacity}`;
      let tag = tags.get(id);
      if (!tag || tag.text !== text) {
        if (tag) disposeTag(scene, tag);
        tag = makeTag(scene, text);
        tags.set(id, tag);
      }

      const pos = components.Position;
      tag.sprite.position.set(pos.x, pos.y + TAG_OFFSET, pos.z);

      _delta.set(pos.x - _camPos.x, pos.y - _camPos.y, pos.z - _camPos.z);
      const dist = _delta.length();
      const facingDot = _delta.dot(_camFwd);

      let opacity = 1;
      if (facingDot <= 0) {
        opacity = 0;
      } else if (dist >= FADE_END) {
        opacity = 0;
      } else if (dist > FADE_START) {
        opacity = 1 - (dist - FADE_START) / (FADE_END - FADE_START);
      }

      tag.material.opacity = opacity;
      tag.sprite.visible = opacity > 0.01;
    }

    for (const [id, tag] of tags) {
      if (!alive.has(id)) {
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
 * @param {string} text
 */
function makeTag(scene, text) {
  const { canvas, aspect } = renderTextToCanvas(text);
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
  sprite.scale.set(TAG_HEIGHT_WORLD * aspect, TAG_HEIGHT_WORLD, 1);
  sprite.renderOrder = 10;
  scene.add(sprite);
  return { sprite, material, texture, text };
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

/**
 * @param {string} text
 */
function renderTextToCanvas(text) {
  const pad = 20;
  const fontPx = 56;
  const measureCanvas = document.createElement('canvas');
  const measureCtx = /** @type {CanvasRenderingContext2D} */ (measureCanvas.getContext('2d'));
  measureCtx.font = `bold ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const metrics = measureCtx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const width = Math.max(96, textWidth + pad * 2);
  const height = fontPx + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.clearRect(0, 0, width, height);
  ctx.font = `bold ${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, width / 2, height / 2);

  return { canvas, aspect: width / height };
}
