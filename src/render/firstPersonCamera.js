/**
 * First-person camera controller with two sub-modes:
 *   - spectate: ride along on a cow's head, look direction follows the cow's
 *     velocity. The cow keeps doing its AI job.
 *   - control: player takes over the cow. Mouse-look via pointer lock, WASD
 *     drives the cow's velocity directly. Brain + cowFollowPath skip any cow
 *     whose Job.kind === 'player' so they don't fight the input.
 *
 * Sitting in the render layer (not ECS): the controller updates the three.js
 * camera each frame, and when in 'control' mode pokes the controlled cow's
 * Velocity so the sim integrates it like any other cow.
 */

import * as THREE from 'three';
import { UNITS_PER_METER } from '../world/coords.js';

const HEAD_HEIGHT = 1.2 * UNITS_PER_METER;
const DRIVE_SPEED = 120; // ≈2.8 tiles/sec, a touch faster than AI cows
const MOUSE_SENSITIVITY = 0.0025;
const MAX_PITCH = Math.PI * 0.45;
const _look = new THREE.Vector3();

export class FirstPersonCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLCanvasElement} canvas
   * @param {import('../ecs/world.js').World} world
   * @param {() => void} onChange  HUD rebuild hook
   */
  constructor(camera, canvas, world, onChange) {
    this.camera = camera;
    this.canvas = canvas;
    this.world = world;
    this.onChange = onChange;
    /** @type {'off' | 'spectate' | 'control'} */
    this.mode = 'off';
    /** @type {number | null} */
    this.cowId = null;
    this.yaw = 0;
    this.pitch = 0;
    /** @type {Set<string>} */
    this.keys = new Set();
    this.#bind();
  }

  get active() {
    return this.mode !== 'off';
  }

  /** @param {number} cowId */
  enterSpectate(cowId) {
    if (!this.world.get(cowId, 'Position')) return;
    this.cowId = cowId;
    this.mode = 'spectate';
    const vel = this.world.get(cowId, 'Velocity');
    if (vel && Math.hypot(vel.x, vel.z) > 0.01) {
      this.yaw = Math.atan2(vel.x, vel.z);
    }
    this.pitch = 0;
    this.onChange();
  }

  exit() {
    if (this.mode === 'control') this.releaseControl();
    this.mode = 'off';
    this.cowId = null;
    this.onChange();
  }

  /** @param {number} dir  +1 = next, -1 = prev */
  cycle(dir) {
    if (this.mode === 'off') return;
    const cows = [];
    for (const { id } of this.world.query(['Cow', 'Position'])) cows.push(id);
    if (cows.length === 0) {
      this.exit();
      return;
    }
    const wasControlling = this.mode === 'control';
    if (wasControlling) this.releaseControl();
    const idx = this.cowId !== null ? cows.indexOf(this.cowId) : -1;
    const next = (idx + dir + cows.length) % cows.length;
    this.cowId = cows[next];
    this.onChange();
  }

  takeControl() {
    if (this.mode !== 'spectate' || this.cowId === null) return;
    const job = this.world.get(this.cowId, 'Job');
    const path = this.world.get(this.cowId, 'Path');
    if (job) {
      job.kind = 'player';
      job.state = 'driving';
      job.payload = {};
    }
    if (path) {
      path.steps = [];
      path.index = 0;
    }
    this.mode = 'control';
    // Pointer lock requires a user gesture — we're inside a keydown handler.
    try {
      this.canvas.requestPointerLock();
    } catch {
      /* non-fatal: continue without lock */
    }
    this.onChange();
  }

  releaseControl() {
    if (this.cowId !== null) {
      const job = this.world.get(this.cowId, 'Job');
      const vel = this.world.get(this.cowId, 'Velocity');
      if (job && job.kind === 'player') {
        job.kind = 'none';
        job.state = 'idle';
        job.payload = {};
      }
      if (vel) {
        vel.x = 0;
        vel.z = 0;
      }
    }
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (this.mode === 'control') this.mode = 'spectate';
    this.onChange();
  }

  /** @param {number} _dt */
  update(_dt) {
    if (this.mode === 'off' || this.cowId === null) return;
    const pos = this.world.get(this.cowId, 'Position');
    if (!pos) {
      this.exit();
      return;
    }

    if (this.mode === 'control') {
      const vel = this.world.get(this.cowId, 'Velocity');
      if (vel) {
        let f = 0;
        let r = 0;
        if (this.keys.has('KeyW')) f += 1;
        if (this.keys.has('KeyS')) f -= 1;
        if (this.keys.has('KeyD')) r += 1;
        if (this.keys.has('KeyA')) r -= 1;
        if (f !== 0 || r !== 0) {
          const len = Math.hypot(f, r);
          f /= len;
          r /= len;
          // Look dir F = (sin y, 0, cos y). Screen-right R = (-cos y, 0, sin y)
          // — world -X at yaw=0, because a three.js camera doing lookAt(+Z)
          // is rotated 180° around Y vs its default, so its local +X (screen
          // right) maps to world -X.
          const sinY = Math.sin(this.yaw);
          const cosY = Math.cos(this.yaw);
          vel.x = (f * sinY - r * cosY) * DRIVE_SPEED;
          vel.z = (f * cosY + r * sinY) * DRIVE_SPEED;
          vel.y = 0;
        } else {
          vel.x = 0;
          vel.z = 0;
        }
      }
    }

    const x = pos.x;
    const y = pos.y + HEAD_HEIGHT;
    const z = pos.z;
    this.camera.position.set(x, y, z);

    let viewYaw = this.yaw;
    let viewPitch = this.pitch;
    if (this.mode === 'spectate') {
      const vel = this.world.get(this.cowId, 'Velocity');
      if (vel && Math.hypot(vel.x, vel.z) > 0.01) {
        viewYaw = Math.atan2(vel.x, vel.z);
        this.yaw = viewYaw; // remember last facing so takeover starts aligned
      }
      viewPitch = 0;
    }
    const cosP = Math.cos(viewPitch);
    _look.set(x + Math.sin(viewYaw) * cosP, y + Math.sin(viewPitch), z + Math.cos(viewYaw) * cosP);
    this.camera.lookAt(_look);
  }

  #bind() {
    addEventListener('keydown', (e) => {
      if (this.mode === 'off') return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    document.addEventListener('mousemove', (e) => {
      if (this.mode !== 'control') return;
      if (document.pointerLockElement !== this.canvas) return;
      // Mouse right (+movementX) should turn the view right. World right at
      // yaw=0 is -X, reached by sin(yaw)<0 ⟹ yaw decreases.
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, this.pitch - e.movementY * MOUSE_SENSITIVITY),
      );
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.mode === 'control' && document.pointerLockElement !== this.canvas) {
        // Pressed Esc (or something else dropped the lock). Bail to spectate.
        this.releaseControl();
      }
    });
  }
}
