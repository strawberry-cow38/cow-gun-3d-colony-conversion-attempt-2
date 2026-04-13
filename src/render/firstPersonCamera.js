/**
 * First-person camera: view through a cow's eyes. What happens while in FP
 * depends on the viewed cow's `Cow.drafted` flag:
 *   - free cow: passive spectate. Look direction follows the cow's velocity.
 *     The cow keeps doing its AI job — no input wiring.
 *   - drafted cow: direct drive. Mouse-look via pointer lock, WASD writes
 *     Velocity on the cow. cowFollowPath skips this id (see `drivingCowId`)
 *     so the path system doesn't fight the input.
 *
 * Drafting/undrafting the viewed cow flips between the two modes without
 * re-entering FP — pointer lock is acquired/released inside update(), and
 * `drivingCowId` always reflects the current truth for the follow-path
 * system to query.
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
    /** @type {'off' | 'active'} */
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

  /**
   * True when FP is active and the viewed cow is drafted — meaning this
   * controller owns that cow's Velocity this frame. The follow-path system
   * reads this to skip the driven cow.
   * @returns {number | null}
   */
  get drivingCowId() {
    if (!this.active || this.cowId === null) return null;
    const cow = this.world.get(this.cowId, 'Cow');
    return cow?.drafted ? this.cowId : null;
  }

  /** @param {number} cowId */
  enter(cowId) {
    if (!this.world.get(cowId, 'Position')) return;
    this.cowId = cowId;
    this.mode = 'active';
    const vel = this.world.get(cowId, 'Velocity');
    if (vel && Math.hypot(vel.x, vel.z) > 0.01) {
      this.yaw = Math.atan2(vel.x, vel.z);
    }
    this.pitch = 0;
    this.onChange();
  }

  exit() {
    this.#releasePointerLock();
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
    // Release lock proactively — update() will re-acquire if the new cow is
    // drafted. Cleaner than a stale lock pointing at the previous cow.
    this.#releasePointerLock();
    const idx = this.cowId !== null ? cows.indexOf(this.cowId) : -1;
    const next = (idx + dir + cows.length) % cows.length;
    this.cowId = cows[next];
    // Zero out the previous cow's leftover velocity so it doesn't cruise off
    // once we stop driving it.
    const prevVel = idx >= 0 ? this.world.get(cows[idx], 'Velocity') : null;
    if (prevVel) {
      const prevCow = this.world.get(cows[idx], 'Cow');
      if (prevCow?.drafted) {
        prevVel.x = 0;
        prevVel.z = 0;
      }
    }
    this.onChange();
  }

  /** @param {number} _dt */
  update(_dt) {
    if (this.mode === 'off' || this.cowId === null) return;
    const pos = this.world.get(this.cowId, 'Position');
    const cow = this.world.get(this.cowId, 'Cow');
    if (!pos || !cow) {
      this.exit();
      return;
    }

    const driving = cow.drafted === true;
    this.#syncPointerLock(driving);

    if (driving) {
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
    if (!driving) {
      const vel = this.world.get(this.cowId, 'Velocity');
      if (vel && Math.hypot(vel.x, vel.z) > 0.01) {
        viewYaw = Math.atan2(vel.x, vel.z);
        this.yaw = viewYaw; // remember last facing so draft-takeover starts aligned
      }
      viewPitch = 0;
    }
    const cosP = Math.cos(viewPitch);
    _look.set(x + Math.sin(viewYaw) * cosP, y + Math.sin(viewPitch), z + Math.cos(viewYaw) * cosP);
    this.camera.lookAt(_look);
  }

  /** @param {boolean} driving */
  #syncPointerLock(driving) {
    const locked = document.pointerLockElement === this.canvas;
    if (driving && !locked) {
      // Pointer-lock requests outside a user gesture fail silently on most
      // browsers — but when we DO have a gesture (R key handler), this
      // acquires immediately. If we don't, the view just stays mouse-free
      // until the next gesture, which is acceptable.
      try {
        this.canvas.requestPointerLock();
      } catch {
        /* non-fatal */
      }
    } else if (!driving && locked) {
      document.exitPointerLock();
    }
  }

  #releasePointerLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
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
      if (!this.active) return;
      if (document.pointerLockElement !== this.canvas) return;
      // Mouse right (+movementX) should turn the view right. World right at
      // yaw=0 is -X, reached by sin(yaw)<0 ⟹ yaw decreases.
      this.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, this.pitch - e.movementY * MOUSE_SENSITIVITY),
      );
    });
  }
}
