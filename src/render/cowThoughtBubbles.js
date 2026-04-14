/**
 * Floating thought bubbles above each cow — short text describing whatever
 * the cow is currently doing ("hauling", "to tree", "idle"…). Mirrors the
 * billboard / fade / cache-by-text scheme of cowNameTags, but positioned
 * higher so the two don't overlap.
 *
 * Thoughts derive from `Job.kind` + `Job.state`, so they change only when
 * the state machine does — a CanvasTexture cache keyed by thought text
 * (not by cow id) means each unique phrase is painted at most once.
 */

import * as THREE from 'three';
import { UNITS_PER_METER } from '../world/coords.js';
import { thoughtFor } from './cowThoughtText.js';

const HEAD_OFFSET = 3.2 * UNITS_PER_METER; // above the name tag
const BUBBLE_HEIGHT_WORLD = 0.55 * UNITS_PER_METER;
const FADE_START = 20 * UNITS_PER_METER;
const FADE_END = 90 * UNITS_PER_METER;
// Soft ceiling on the per-phrase canvas/texture cache. Current `thoughtFor`
// returns from a fixed ~15-phrase enum so we never get near this, but if a
// future phrase ever interpolates (e.g. "hauling to stockpile 3") the cache
// would otherwise grow unbounded and leak GPU textures. Evicting unreferenced
// entries when we cross the cap keeps GPU memory bounded.
const CACHE_CAP = 64;

const _camPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _delta = new THREE.Vector3();

/**
 * @param {THREE.Scene} scene
 */
export function createCowThoughtBubbles(scene) {
  /**
   * @type {Map<number, { sprite: THREE.Sprite, material: THREE.SpriteMaterial, text: string }>}
   */
  const bubbles = new Map();
  // Cache canvas+texture+aspect keyed by text with a refcount per entry.
  // Insertion order = LRU recency (touched entries get deleted+reinserted on
  // hit). When the cache crosses CACHE_CAP we dispose textures for the
  // oldest entries whose refcount has dropped to 0. Actively-referenced
  // phrases stay pinned so we never dispose a texture a live sprite is using.
  /** @type {Map<string, { canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, aspect: number, refs: number }>} */
  const textureCache = new Map();
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

    const alive = new Set();
    for (const { id, components } of world.query(['Cow', 'Position', 'Job'])) {
      alive.add(id);
      const text = thoughtFor(components.Job);
      let bubble = bubbles.get(id);
      if (!bubble || bubble.text !== text) {
        if (bubble) disposeBubble(scene, bubble, textureCache);
        bubble = makeBubble(scene, text, textureCache);
        bubbles.set(id, bubble);
      }

      const pos = components.Position;
      const prev = world.get(id, 'PrevPosition') ?? pos;
      const x = prev.x + (pos.x - prev.x) * alpha;
      const y = prev.y + (pos.y - prev.y) * alpha;
      const z = prev.z + (pos.z - prev.z) * alpha;
      bubble.sprite.position.set(x, y + HEAD_OFFSET, z);

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

      bubble.material.opacity = opacity;
      bubble.sprite.visible = opacity > 0.01;
    }

    for (const [id, bubble] of bubbles) {
      if (!alive.has(id)) {
        disposeBubble(scene, bubble, textureCache);
        bubbles.delete(id);
      }
    }
  }

  /** @param {boolean} v */
  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    for (const bubble of bubbles.values()) bubble.sprite.visible = v;
  }

  return { update, setVisible };
}

/**
 * @param {THREE.Scene} scene
 * @param {string} text
 * @param {Map<string, { canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, aspect: number, refs: number }>} cache
 */
function makeBubble(scene, text, cache) {
  let painted = cache.get(text);
  if (painted) {
    // Touch for LRU recency: delete + reinsert moves the entry to the Map's
    // tail, so the eviction scan (which walks insertion order) sees it last.
    cache.delete(text);
    cache.set(text, painted);
  } else {
    const { canvas, aspect } = renderTextToCanvas(text);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    painted = { canvas, texture, aspect, refs: 0 };
    cache.set(text, painted);
    evictIfFull(cache);
  }
  painted.refs++;

  const material = new THREE.SpriteMaterial({
    map: painted.texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(BUBBLE_HEIGHT_WORLD * painted.aspect, BUBBLE_HEIGHT_WORLD, 1);
  sprite.renderOrder = 11;
  scene.add(sprite);
  return { sprite, material, text };
}

/**
 * @param {THREE.Scene} scene
 * @param {{ sprite: THREE.Sprite, material: THREE.SpriteMaterial, text: string }} bubble
 * @param {Map<string, { canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, aspect: number, refs: number }>} cache
 */
function disposeBubble(scene, bubble, cache) {
  scene.remove(bubble.sprite);
  bubble.material.dispose();
  const entry = cache.get(bubble.text);
  if (entry && entry.refs > 0) entry.refs--;
}

/**
 * Dispose + evict the oldest unreferenced cache entries until size ≤ cap.
 * Pinned (refs > 0) entries are skipped so a live sprite's texture never
 * gets yanked out from under it — the cache may briefly overshoot CACHE_CAP
 * until their refs fall to 0.
 *
 * @param {Map<string, { canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, aspect: number, refs: number }>} cache
 */
function evictIfFull(cache) {
  if (cache.size <= CACHE_CAP) return;
  for (const [key, entry] of cache) {
    if (entry.refs === 0) {
      entry.texture.dispose();
      cache.delete(key);
      if (cache.size <= CACHE_CAP) return;
    }
  }
}

/**
 * @param {string} text
 */
function renderTextToCanvas(text) {
  const pad = 20;
  const fontPx = 56;
  const measureCanvas = document.createElement('canvas');
  const measureCtx = /** @type {CanvasRenderingContext2D} */ (measureCanvas.getContext('2d'));
  measureCtx.font = `${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const metrics = measureCtx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const width = Math.max(96, textWidth + pad * 2);
  const height = fontPx + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.clearRect(0, 0, width, height);

  // Rounded pill background — fills the canvas, so the sprite already has the
  // right aspect from the measurement above.
  const radius = height / 2;
  ctx.fillStyle = 'rgba(24, 24, 30, 0.78)';
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(width - radius, 0);
  ctx.arc(width - radius, radius, radius, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(radius, height);
  ctx.arc(radius, radius, radius, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
  ctx.fill();

  ctx.font = `${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0f0f0';
  ctx.fillText(text, width / 2, height / 2);

  return { canvas, aspect: width / height };
}
