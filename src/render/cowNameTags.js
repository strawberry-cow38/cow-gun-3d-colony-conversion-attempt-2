/**
 * Floating billboard name tags above each cow. One Sprite per cow, cached
 * by entity id. Text is rendered to a canvas once per unique name and
 * reused via CanvasTexture; if a cow's name changes we regenerate.
 *
 * Tags fade to zero opacity past `FADE_END` world units from the camera and
 * hide entirely when the cow is behind the camera's forward direction so
 * they don't bleed through the back of the frustum.
 *
 * Sprites are THREE.Sprite so billboarding is free — SpriteMaterial keeps
 * them camera-aligned in both yaw and pitch.
 */

import * as THREE from 'three';
import { UNITS_PER_METER } from '../world/coords.js';
import { nameFontFor, nameFontScaleFor } from '../world/traits.js';

const HEAD_OFFSET = 2.2 * UNITS_PER_METER;
const TAG_HEIGHT_WORLD = 1.1 * UNITS_PER_METER;
const FADE_START = 30 * UNITS_PER_METER;
const FADE_END = 120 * UNITS_PER_METER;

const _camPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _delta = new THREE.Vector3();

/**
 * @param {THREE.Scene} scene
 */
export function createCowNameTags(scene) {
  /**
   * @type {Map<number, { sprite: THREE.Sprite, material: THREE.SpriteMaterial, texture: THREE.CanvasTexture, key: string }>}
   */
  const tags = new Map();
  let visible = true;

  // Tag textures drawn before the handwriting fonts finish downloading render
  // in the fallback stack. Bump fontVersion once loads resolve so the next
  // update regenerates every affected tag.
  let fontVersion = 0;
  if (typeof document !== 'undefined' && document.fonts) {
    Promise.all([
      document.fonts.load("700 72px 'Caveat'"),
      document.fonts.load("700 72px 'Great Vibes'"),
      document.fonts.load("400 72px 'Rock Salt'"),
    ])
      .then(() => {
        fontVersion++;
      })
      .catch(() => {});
  }

  /**
   * @param {import('../ecs/world.js').World} world
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} alpha
   */
  function update(world, camera, alpha) {
    if (!visible) return;
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camFwd);

    const alive = new Set();
    for (const { id, components } of world.query(['Cow', 'Position', 'Brain', 'Identity'])) {
      alive.add(id);
      const name = components.Brain.name ?? `#${id}`;
      const family = nameFontFor(components.Identity.traits);
      const scale = nameFontScaleFor(components.Identity.traits);
      const key = `${id}|${name}|${family}|${scale}|${fontVersion}`;
      let tag = tags.get(id);
      if (!tag || tag.key !== key) {
        if (tag) disposeTag(scene, tag);
        tag = makeTag(scene, name, family, scale, key);
        tags.set(id, tag);
      }

      const pos = components.Position;
      const prev = world.get(id, 'PrevPosition') ?? pos;
      const x = prev.x + (pos.x - prev.x) * alpha;
      const y = prev.y + (pos.y - prev.y) * alpha;
      const z = prev.z + (pos.z - prev.z) * alpha;
      tag.sprite.position.set(x, y + HEAD_OFFSET, z);

      _delta.set(x - _camPos.x, y - _camPos.y, z - _camPos.z);
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
 * @param {string} name
 * @param {string} family
 * @param {number} scale
 * @param {string} key
 */
function makeTag(scene, name, family, scale, key) {
  const { canvas, aspect } = renderTextToCanvas(name, family, scale);
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
  return { sprite, material, texture, key };
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
 * @param {string} name
 * @param {string} family
 * @param {number} scale
 */
function renderTextToCanvas(name, family, scale) {
  const pad = 24;
  const fontPx = Math.round(72 * scale);
  const font = `700 ${fontPx}px ${family}`;
  const measureCanvas = document.createElement('canvas');
  const measureCtx = /** @type {CanvasRenderingContext2D} */ (measureCanvas.getContext('2d'));
  measureCtx.font = font;
  const totalW = measureCtx.measureText(name).width;
  const width = Math.max(128, Math.ceil(totalW) + pad * 2);
  const height = fontPx + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.clearRect(0, 0, width, height);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.fillStyle = '#ffffff';
  ctx.strokeText(name, width / 2, height / 2);
  ctx.fillText(name, width / 2, height / 2);

  return { canvas, aspect: width / height };
}
