/**
 * Floating billboard tags that sit above every bed, labelled with the
 * owner's name or "Unassigned" when nothing is claimed. Mirrors the
 * cowNameTags pattern (Sprite + CanvasTexture) but positions are fixed to
 * the bed's anchor tile so there's no per-frame interpolation — just
 * read-pose-of-static-object.
 */

import * as THREE from 'three';
import { TILE_SIZE, UNITS_PER_METER, tileToWorld } from '../world/coords.js';
import { FACING_OFFSETS } from '../world/facing.js';
import { BED_HEADBOARD_HEIGHT } from './bedInstancer.js';

const TAG_Y_OFFSET = BED_HEADBOARD_HEIGHT + 0.45 * UNITS_PER_METER;
const TAG_HEIGHT_WORLD = 0.6 * UNITS_PER_METER;
const FADE_START = 30 * UNITS_PER_METER;
const FADE_END = 120 * UNITS_PER_METER;
const UNASSIGNED_COLOR = '#d9a0a0';
const OWNED_COLOR = '#ffffff';

const _camPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();
const _delta = new THREE.Vector3();

/**
 * @param {THREE.Scene} scene
 */
export function createBedNameTags(scene) {
  /**
   * @type {Map<number, { sprite: THREE.Sprite, material: THREE.SpriteMaterial, texture: THREE.CanvasTexture, key: string }>}
   */
  const tags = new Map();
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
    for (const { id, components } of world.query(['Bed', 'TileAnchor'])) {
      alive.add(id);
      const bed = components.Bed;
      const anchor = components.TileAnchor;
      const ownerName = bed.ownerId > 0 ? nameOf(world, bed.ownerId) : '';
      const label = ownerName || 'Unassigned';
      const owned = ownerName.length > 0;
      const key = `${id}|${label}|${owned ? 'O' : 'U'}`;
      let tag = tags.get(id);
      if (!tag || tag.key !== key) {
        if (tag) disposeTag(scene, tag);
        tag = makeTag(scene, label, owned, key);
        tags.set(id, tag);
      }

      const off = FACING_OFFSETS[bed.facing | 0] ?? FACING_OFFSETS[0];
      const world0 = tileToWorld(anchor.i, anchor.j, grid.W, grid.H);
      const cx = world0.x + off.di * (TILE_SIZE / 2);
      const cz = world0.z + off.dj * (TILE_SIZE / 2);
      const cy = grid.getElevation(anchor.i, anchor.j) + TAG_Y_OFFSET;
      tag.sprite.position.set(cx, cy, cz);

      _delta.set(cx - _camPos.x, cy - _camPos.y, cz - _camPos.z);
      const dist = _delta.length();
      const facingDot = _delta.dot(_camFwd);

      let opacity = 1;
      if (facingDot <= 0) opacity = 0;
      else if (dist >= FADE_END) opacity = 0;
      else if (dist > FADE_START) opacity = 1 - (dist - FADE_START) / (FADE_END - FADE_START);

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
 * @param {string} label
 * @param {boolean} owned
 * @param {string} key
 */
function makeTag(scene, label, owned, key) {
  const { canvas, aspect } = renderTextToCanvas(label, owned);
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
 * @param {string} label
 * @param {boolean} owned
 */
function renderTextToCanvas(label, owned) {
  const pad = 24;
  const fontPx = 64;
  const font = `600 ${fontPx}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  const measureCanvas = document.createElement('canvas');
  const measureCtx = /** @type {CanvasRenderingContext2D} */ (measureCanvas.getContext('2d'));
  measureCtx.font = font;
  const textW = measureCtx.measureText(label).width;
  const width = Math.max(128, Math.ceil(textW) + pad * 2);
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
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillStyle = owned ? OWNED_COLOR : UNASSIGNED_COLOR;
  ctx.strokeText(label, width / 2, height / 2);
  ctx.fillText(label, width / 2, height / 2);

  return { canvas, aspect: width / height };
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {number} cowId
 */
function nameOf(world, cowId) {
  const ident = world.get(cowId, 'Identity');
  if (ident?.nickname) return ident.nickname;
  if (ident?.firstName) return ident.firstName;
  const brain = world.get(cowId, 'Brain');
  return brain?.name ?? '';
}
