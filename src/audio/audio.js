/**
 * Directional (HRTF-panned) sound engine.
 *
 * Exposes `playAt(kind, pos)` for world-space one-shots. The listener rides
 * the active camera rig — overhead, follow, or first-person — so what the
 * player hears lines up with what they see without any coupling to the
 * camera mode.
 *
 * Procedural generators (src/audio/sfx.js) plug in via the `SFX` registry.
 * Swapping in sample-backed playback later is a one-function change per kind
 * — same `(ctx, dest) => duration` contract.
 *
 * AudioContext creation is deferred to the first user gesture; autoplay
 * policies would otherwise start us in a suspended state that never
 * unsticks. Calls to `playAt` before the first gesture are silently dropped.
 *
 * Per-kind concurrency caps keep a stampede of 1000 cow footfalls from
 * allocating 2000 nodes per second — above the cap, new emissions drop.
 */

import * as THREE from 'three';
import { playChop, playFootfall, playMunch } from './sfx.js';

/**
 * @typedef {Object} SfxEntry
 * @property {import('./sfx.js').SfxGenerator} gen
 * @property {number} maxConcurrent
 */

/** @type {Record<string, SfxEntry>} */
const SFX = {
  chop: { gen: playChop, maxConcurrent: 4 },
  munch: { gen: playMunch, maxConcurrent: 6 },
  footfall: { gen: playFootfall, maxConcurrent: 8 },
};

const MASTER_GAIN = 0.35;
const MAX_HEAR_DIST = 400; // units (≈ 9 tiles) — beyond this we don't allocate

/**
 * @param {{ camera: import('three').Camera }} opts
 */
export function createAudio({ camera }) {
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {GainNode | null} */
  let master = null;

  const active = /** @type {Record<string, number>} */ ({});
  for (const k of Object.keys(SFX)) active[k] = 0;

  const _camPos = new THREE.Vector3();
  const _camFwd = new THREE.Vector3();

  function ensureContext() {
    if (ctx) return ctx;
    const AC =
      /** @type {any} */ (globalThis).AudioContext ??
      /** @type {any} */ (globalThis).webkitAudioContext;
    if (!AC) return null;
    ctx = /** @type {AudioContext} */ (new AC());
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    return ctx;
  }

  // Browsers require an AudioContext resume inside a user-gesture handler.
  // `{ once: true }` makes these self-removing so they don't count as a
  // permanent listener leak — same reason installKeyboard's single
  // addEventListener is safe.
  const resume = () => {
    const c = ensureContext();
    if (c && c.state === 'suspended') void c.resume();
  };
  addEventListener('pointerdown', resume, { once: true });
  addEventListener('keydown', resume, { once: true });

  function update() {
    if (!ctx) return;
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camFwd);
    const L = ctx.listener;
    // Newer browsers expose AudioParams (positionX, forwardX…); older ones
    // only the setPosition / setOrientation setters. Feature-test and pick.
    if ('positionX' in L) {
      L.positionX.value = _camPos.x;
      L.positionY.value = _camPos.y;
      L.positionZ.value = _camPos.z;
      L.forwardX.value = _camFwd.x;
      L.forwardY.value = _camFwd.y;
      L.forwardZ.value = _camFwd.z;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      /** @type {any} */ (L).setPosition(_camPos.x, _camPos.y, _camPos.z);
      /** @type {any} */ (L).setOrientation(_camFwd.x, _camFwd.y, _camFwd.z, 0, 1, 0);
    }
  }

  /**
   * @param {string} kind
   * @param {{ x: number, y: number, z: number }} pos
   */
  function playAt(kind, pos) {
    if (!ctx || !master) return;
    const entry = SFX[kind];
    if (!entry) return;
    if (active[kind] >= entry.maxConcurrent) return;

    // Cull before allocating nodes — cheaper than any node-level distance
    // model. _camPos is refreshed each `update()`, so we use the latest.
    const dx = pos.x - _camPos.x;
    const dy = pos.y - _camPos.y;
    const dz = pos.z - _camPos.z;
    if (dx * dx + dy * dy + dz * dz > MAX_HEAR_DIST * MAX_HEAR_DIST) return;

    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 20;
    panner.maxDistance = MAX_HEAR_DIST;
    panner.rolloffFactor = 1.4;
    if ('positionX' in panner) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else {
      /** @type {any} */ (panner).setPosition(pos.x, pos.y, pos.z);
    }
    panner.connect(master);
    active[kind]++;
    const dur = entry.gen(ctx, panner);
    // Disconnect after the clip finishes so the node graph doesn't grow
    // without bound. +50ms pad for exponential tails.
    setTimeout(
      () => {
        try {
          panner.disconnect();
        } catch {
          /* already gone */
        }
        active[kind]--;
      },
      (dur + 0.05) * 1000,
    );
  }

  return { update, playAt };
}
