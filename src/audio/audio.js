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
import { playRainLoop } from './ambient.js';
import { createMusic } from './music.js';
import {
  playChop,
  playDoor,
  playFootfall,
  playHammer,
  playMunch,
  playSplash,
  playThunder,
} from './sfx.js';
import {
  playClick,
  playCommand,
  playCycle,
  playDeny,
  playDraft,
  playDrop,
  playLoad,
  playSave,
  playSpawn,
  playToggleOff,
  playToggleOn,
  playUndraft,
} from './uisfx.js';

/**
 * @typedef {Object} SfxEntry
 * @property {import('./sfx.js').SfxGenerator} gen
 * @property {number} maxConcurrent
 */

/** @type {Record<string, SfxEntry>} */
const SFX = {
  chop: { gen: playChop, maxConcurrent: 4 },
  hammer: { gen: playHammer, maxConcurrent: 4 },
  munch: { gen: playMunch, maxConcurrent: 6 },
  footfall: { gen: playFootfall, maxConcurrent: 8 },
  splash: { gen: playSplash, maxConcurrent: 8 },
  door: { gen: playDoor, maxConcurrent: 4 },
};

/**
 * Non-spatial UI sounds — no panner, fed directly into the master gain.
 * Lighter concurrency cap than spatial SFX because UI events cluster in
 * bursts (e.g. rapid-clicking cows) and we don't want them to stack into
 * a wall of sound.
 *
 * @type {Record<string, import('./uisfx.js').UiSfxGenerator>}
 */
const UI_SFX = {
  click: playClick,
  command: playCommand,
  toggle_on: playToggleOn,
  toggle_off: playToggleOff,
  save: playSave,
  load: playLoad,
  draft: playDraft,
  undraft: playUndraft,
  spawn: playSpawn,
  drop: playDrop,
  cycle: playCycle,
  deny: playDeny,
  // Thunder is non-spatial (peals the whole sky, not a point source) and
  // wants to pierce through the rain loop, so it feeds the master gain
  // directly — same path as UI one-shots even though it isn't "UI".
  thunder: playThunder,
};

const UI_MAX_CONCURRENT = 6;

/**
 * Long-running ambient loops (rain, wind, ocean, …). Each entry bakes in its
 * opts (peak gain, fade durations) via a thin closure, so callers just ask
 * for `rain` vs `storm` without knowing the mixing knobs. Generators return a
 * teardown function so the engine can fade them out cleanly when the weather
 * or scene changes.
 *
 * @type {Record<string, (ctx: AudioContext, dest: AudioNode) => () => void>}
 */
const LOOP_SFX = {
  rain: (ctx, dest) => playRainLoop(ctx, dest, { gain: 0.16, fadeIn: 3.0, fadeOut: 2.0 }),
  // Storm rain is louder and fades in slightly slower so the transition into
  // the first lightning flash feels like weather building, not a jump cut.
  storm: (ctx, dest) => playRainLoop(ctx, dest, { gain: 0.3, fadeIn: 4.0, fadeOut: 2.5 }),
};

const MASTER_GAIN = 0.35;
const MAX_HEAR_DIST = 400; // units (≈ 9 tiles) — beyond this we don't allocate
const MUSIC_MUTE_PREF_KEY = 'pref:musicMuted';

function readMusicMutePref() {
  try {
    return globalThis.localStorage?.getItem(MUSIC_MUTE_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMusicMutePref(muted) {
  try {
    if (muted) globalThis.localStorage?.setItem(MUSIC_MUTE_PREF_KEY, '1');
    else globalThis.localStorage?.removeItem(MUSIC_MUTE_PREF_KEY);
  } catch {
    /* private mode etc — fine to drop */
  }
}

/**
 * @param {{ camera: import('three').Camera }} opts
 */
export function createAudio({ camera }) {
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {GainNode | null} */
  let master = null;
  let musicMuted = readMusicMutePref();
  /** @type {((muted: boolean) => void) | null} */
  let muteListener = null;

  const active = /** @type {Record<string, number>} */ ({});
  for (const k of Object.keys(SFX)) active[k] = 0;
  let uiActive = 0;
  /** @type {Record<string, (() => void) | undefined>} */
  const activeLoops = {};
  /** @type {Set<string>} — queued before the AudioContext exists */
  const pendingLoops = new Set();
  /** @type {ReturnType<typeof createMusic> | null} */
  let music = null;

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

  function setMusicMuted(next) {
    if (next === musicMuted) return;
    musicMuted = next;
    // Pause the HTMLAudioElement directly — gain=0 on the music subgraph
    // would silence output but leave the browser streaming + decoding the ogg.
    if (musicMuted) music?.pause();
    else music?.resume();
    writeMusicMutePref(musicMuted);
    muteListener?.(musicMuted);
  }

  // Browsers require an AudioContext resume inside a user-gesture handler.
  // `{ once: true }` makes these self-removing so they don't count as a
  // permanent listener leak — same reason installKeyboard's single
  // addEventListener is safe.
  const resume = () => {
    const c = ensureContext();
    if (c && c.state === 'suspended') void c.resume();
    // Flush any loops that were queued before we had a context.
    if (c && master) {
      for (const kind of pendingLoops) {
        const gen = LOOP_SFX[kind];
        if (gen && !activeLoops[kind]) activeLoops[kind] = gen(c, master);
      }
      pendingLoops.clear();
      if (!music) music = createMusic({ ctx: c, master });
      music.start();
      // start() always begins playback; if the saved pref is muted, stop the
      // element immediately so the browser doesn't stream the first track.
      if (musicMuted) music.pause();
    }
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

  /**
   * Non-spatial UI one-shot. Feeds the master gain directly — no panning,
   * no distance cull. Use for sounds tied to player input (clicks, toggles,
   * mode transitions, save/load) where the "source" is the UI itself.
   *
   * @param {string} kind
   */
  function play(kind) {
    if (!ctx || !master) return;
    const gen = UI_SFX[kind];
    if (!gen) return;
    if (uiActive >= UI_MAX_CONCURRENT) return;
    uiActive++;
    const dur = gen(ctx, master);
    setTimeout(
      () => {
        uiActive--;
      },
      (dur + 0.05) * 1000,
    );
  }

  /**
   * Start a looping ambient layer. If the AudioContext hasn't been created
   * yet (no user gesture), the request is queued and flushed on the first
   * pointerdown/keydown. Idempotent — calling with an already-active kind
   * is a no-op.
   *
   * @param {string} kind
   */
  function startLoop(kind) {
    if (!LOOP_SFX[kind]) return;
    if (activeLoops[kind]) return;
    if (!ctx || !master) {
      pendingLoops.add(kind);
      return;
    }
    activeLoops[kind] = LOOP_SFX[kind](ctx, master);
  }

  /** @param {string} kind */
  function stopLoop(kind) {
    pendingLoops.delete(kind);
    const stop = activeLoops[kind];
    if (stop) {
      stop();
      activeLoops[kind] = undefined;
    }
  }

  return {
    update,
    playAt,
    play,
    startLoop,
    stopLoop,
    getMusicTrack: () => music?.getCurrentTrack() ?? null,
    stopMusic: () => music?.stop(),
    toggleMusicMute: () => {
      setMusicMuted(!musicMuted);
      return musicMuted;
    },
    /**
     * Single-slot — overwrites any prior subscription. Fires immediately so
     * the caller can sync its initial state in the same call.
     * @param {(muted: boolean) => void} fn
     */
    setMusicMuteListener: (fn) => {
      muteListener = fn;
      fn?.(musicMuted);
    },
  };
}
