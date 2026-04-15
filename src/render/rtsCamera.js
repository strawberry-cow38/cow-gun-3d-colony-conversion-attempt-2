/**
 * RTS-style camera: orbits a focus point on the ground.
 *
 * Controls:
 * - WASD / arrow keys    → pan focus point along ground plane
 * - Middle-click drag    → orbit (yaw + pitch)
 * - Mouse wheel          → zoom (change distance from focus)
 * - One-finger drag      → pan (drag-the-world: finger right = view shifts right)
 * - Two-finger pinch     → zoom
 * - Two-finger drag      → orbit (yaw + pitch)
 *
 * Right-click is intentionally reserved for in-world context menus later.
 *
 * The camera object is a THREE.PerspectiveCamera; this class owns its
 * position/lookAt and updates them every frame via update(dt).
 */

import * as THREE from 'three';
import { TILE_SIZE } from '../world/coords.js';

const _v = new THREE.Vector3();

export class RtsCamera {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} dom
   */
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.focus = new THREE.Vector3(0, 0, 0);
    // Defaults scale to tile size so the whole grid is framed sensibly.
    this.distance = TILE_SIZE * 20;
    this.yaw = Math.PI * 0.25;
    this.pitch = Math.PI * 0.32;
    this.minPitch = 0.15;
    this.maxPitch = Math.PI * 0.49;
    this.minDistance = TILE_SIZE * 0.5;
    this.maxDistance = TILE_SIZE * 200;
    // Pan bounds on the ground plane. Defaults to unbounded so tests /
    // callers that don't care aren't broken; main.js sets real bounds from
    // the grid extents once it has them.
    this.minX = Number.NEGATIVE_INFINITY;
    this.maxX = Number.POSITIVE_INFINITY;
    this.minZ = Number.NEGATIVE_INFINITY;
    this.maxZ = Number.POSITIVE_INFINITY;

    /** @type {Set<string>} */
    this.keys = new Set();
    this.dragging = false;
    /** @type {{ x: number, y: number } | null} */
    this.lastMouse = null;
    /** @type {Map<number, { x: number, y: number }>} */
    this.touches = new Map();

    // Pan speed scales with zoom level inside update(); base is ~10 tiles/sec
    // at the default distance.
    this.panSpeedUnits = TILE_SIZE * 10;
    this.panReferenceDistance = this.distance;
    this.orbitSpeed = 0.005;
    this.zoomFactor = 1.15;
    // Touch-drag pan: px → world units. Scaled by current distance so zoomed
    // out views pan proportionally faster than close-ups.
    this.touchPanScale = 0.0022;

    this.#bind();
    this.#syncCamera();
  }

  /** @param {number} dt */
  update(dt) {
    let dx = 0;
    let dz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
      // Rotate input into world coords using the camera's right/forward basis:
      //   right   = ( cos(yaw), 0, -sin(yaw) )
      //   forward = (-sin(yaw), 0, -cos(yaw) )  (camera → focus projected to ground)
      // W/S set dz (dz<0 = forward), A/D set dx (dx>0 = right).
      //   delta = dx*right + (-dz)*forward
      const cos = Math.cos(this.yaw);
      const sin = Math.sin(this.yaw);
      const wx = dx * cos + dz * sin;
      const wz = -dx * sin + dz * cos;
      const fastMult = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2 : 1;
      const speed = this.panSpeedUnits * (this.distance / this.panReferenceDistance) * fastMult;
      this.focus.x += wx * speed * dt;
      this.focus.z += wz * speed * dt;
    }
    this.#syncCamera();
  }

  /**
   * Clamp the focus point to the configured bounds — covers both WASD pan
   * and external focus mutations (follow mode, portrait-bar dbl-click). Runs
   * before every syncCamera so the camera position always lands inside the
   * playable map rather than drifting off into the void.
   */
  #clampFocus() {
    if (this.focus.x < this.minX) this.focus.x = this.minX;
    else if (this.focus.x > this.maxX) this.focus.x = this.maxX;
    if (this.focus.z < this.minZ) this.focus.z = this.minZ;
    else if (this.focus.z > this.maxZ) this.focus.z = this.maxZ;
  }

  #syncCamera() {
    this.#clampFocus();
    const cosP = Math.cos(this.pitch);
    const offX = this.distance * cosP * Math.sin(this.yaw);
    const offY = this.distance * Math.sin(this.pitch);
    const offZ = this.distance * cosP * Math.cos(this.yaw);
    this.camera.position.set(this.focus.x + offX, this.focus.y + offY, this.focus.z + offZ);
    _v.copy(this.focus);
    this.camera.lookAt(_v);
  }

  #bind() {
    addEventListener('keydown', (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
    this.dom.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      // Middle-click in Firefox opens autoscroll; suppress that.
      e.preventDefault();
      this.dragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });
    // Firefox fires `auxclick` on middle-click; prevent it so it doesn't
    // propagate to opening links or autoscroll.
    this.dom.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    addEventListener('mouseup', () => {
      this.dragging = false;
      this.lastMouse = null;
    });
    addEventListener('mousemove', (e) => {
      if (!this.dragging || !this.lastMouse) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * this.orbitSpeed;
      this.pitch = Math.max(
        this.minPitch,
        Math.min(this.maxPitch, this.pitch + dy * this.orbitSpeed),
      );
    });
    this.dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? this.zoomFactor : 1 / this.zoomFactor;
        this.distance = Math.max(
          this.minDistance,
          Math.min(this.maxDistance, this.distance * factor),
        );
      },
      { passive: false },
    );

    this.dom.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        this.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    });
    this.dom.addEventListener('touchmove', (e) => {
      /** @type {Map<number, { x: number, y: number }>} */
      const prev = new Map();
      for (const [k, v] of this.touches) prev.set(k, { x: v.x, y: v.y });
      for (const t of e.changedTouches) {
        if (this.touches.has(t.identifier)) {
          this.touches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
      }
      if (this.touches.size === 1) {
        const [id] = this.touches.keys();
        const now = this.touches.get(id);
        const before = prev.get(id);
        if (!now || !before) return;
        const dx = now.x - before.x;
        const dy = now.y - before.y;
        // Drag-the-world: finger right/down should shift the view in the same
        // direction, so focus moves opposite along the camera's ground basis.
        const cos = Math.cos(this.yaw);
        const sin = Math.sin(this.yaw);
        const scale = this.distance * this.touchPanScale;
        this.focus.x += (-dx * cos + dy * sin) * scale;
        this.focus.z += (dx * sin + dy * cos) * scale;
      } else if (this.touches.size >= 2) {
        const arr = [...this.touches.values()].slice(0, 2);
        const prevArr = [...prev.values()].slice(0, 2);
        if (prevArr.length < 2) return;
        const curDist = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
        const prevDist = Math.hypot(prevArr[0].x - prevArr[1].x, prevArr[0].y - prevArr[1].y);
        if (prevDist > 0 && curDist > 0) {
          const factor = prevDist / curDist;
          this.distance = Math.max(
            this.minDistance,
            Math.min(this.maxDistance, this.distance * factor),
          );
        }
        const curCx = (arr[0].x + arr[1].x) / 2;
        const curCy = (arr[0].y + arr[1].y) / 2;
        const prevCx = (prevArr[0].x + prevArr[1].x) / 2;
        const prevCy = (prevArr[0].y + prevArr[1].y) / 2;
        this.yaw -= (curCx - prevCx) * this.orbitSpeed;
        this.pitch = Math.max(
          this.minPitch,
          Math.min(this.maxPitch, this.pitch + (curCy - prevCy) * this.orbitSpeed),
        );
      }
    });
    const endTouch = (/** @type {TouchEvent} */ e) => {
      for (const t of e.changedTouches) this.touches.delete(t.identifier);
    };
    this.dom.addEventListener('touchend', endTouch);
    this.dom.addEventListener('touchcancel', endTouch);
  }
}
