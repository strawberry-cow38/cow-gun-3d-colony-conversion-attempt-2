/**
 * Click-drag marquee selection.
 *
 * Down/up with no movement = normal click (we don't interfere). Movement past
 * a small pixel threshold turns the gesture into a drag: an overlay `<div>`
 * tracks the mouse, and on release we project every cow's world position to
 * screen space and select everyone inside the rectangle.
 *
 * The `<div>` is placed at body-level with `pointer-events: none` so it
 * never intercepts mouse events. A capture-phase `click` listener on the
 * canvas swallows the synthesized post-drag click so CowSelector/TilePicker
 * don't run — this class must be constructed BEFORE those so its capture
 * handler fires first.
 */

import * as THREE from 'three';

const _v = new THREE.Vector3();

export class SelectionBox {
  /**
   * @param {HTMLElement} dom
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('../ecs/world.js').World} world
   * @param {(ids: number[], additive: boolean) => void} onSelect
   * @param {{ threshold?: number }} [opts]
   */
  constructor(dom, camera, world, onSelect, opts = {}) {
    this.dom = dom;
    this.camera = camera;
    this.world = world;
    this.onSelect = onSelect;
    this.threshold = opts.threshold ?? 5;
    this.mousedown = false;
    this.dragging = false;
    this.startX = 0;
    this.startY = 0;
    this.curX = 0;
    this.curY = 0;
    this.shiftAtDown = false;
    this.justDragged = false;

    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'fixed',
      pointerEvents: 'none',
      border: '1px solid #4ac0ff',
      background: 'rgba(74, 192, 255, 0.12)',
      display: 'none',
      zIndex: '100',
    });
    document.body.appendChild(this.overlay);

    dom.addEventListener('mousedown', (e) => this.#onDown(e));
    addEventListener('mousemove', (e) => this.#onMove(e));
    addEventListener('mouseup', (e) => this.#onUp(e));
    dom.addEventListener(
      'click',
      (e) => {
        if (this.justDragged) {
          e.stopImmediatePropagation();
          e.preventDefault();
          this.justDragged = false;
        }
      },
      { capture: true },
    );
  }

  /** @param {MouseEvent} e */
  #onDown(e) {
    if (e.button !== 0) return;
    this.mousedown = true;
    this.dragging = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.curX = e.clientX;
    this.curY = e.clientY;
    this.shiftAtDown = e.shiftKey;
  }

  /** @param {MouseEvent} e */
  #onMove(e) {
    if (!this.mousedown) return;
    this.curX = e.clientX;
    this.curY = e.clientY;
    if (!this.dragging) {
      const dx = this.curX - this.startX;
      const dy = this.curY - this.startY;
      if (dx * dx + dy * dy < this.threshold * this.threshold) return;
      this.dragging = true;
      this.overlay.style.display = 'block';
    }
    const x = Math.min(this.startX, this.curX);
    const y = Math.min(this.startY, this.curY);
    this.overlay.style.left = `${x}px`;
    this.overlay.style.top = `${y}px`;
    this.overlay.style.width = `${Math.abs(this.curX - this.startX)}px`;
    this.overlay.style.height = `${Math.abs(this.curY - this.startY)}px`;
  }

  /** @param {MouseEvent} e */
  #onUp(e) {
    if (!this.mousedown || e.button !== 0) return;
    this.mousedown = false;
    if (!this.dragging) return;
    this.dragging = false;
    this.overlay.style.display = 'none';
    this.justDragged = true;

    const rect = this.dom.getBoundingClientRect();
    const x0 = Math.min(this.startX, this.curX) - rect.left;
    const y0 = Math.min(this.startY, this.curY) - rect.top;
    const x1 = Math.max(this.startX, this.curX) - rect.left;
    const y1 = Math.max(this.startY, this.curY) - rect.top;

    /** @type {number[]} */
    const ids = [];
    for (const { id, components } of this.world.query(['Cow', 'Position'])) {
      const pos = components.Position;
      _v.set(pos.x, pos.y, pos.z);
      _v.project(this.camera);
      // project() clamps z ∈ [-1, 1] for visible; outside = behind/past planes.
      if (_v.z < -1 || _v.z > 1) continue;
      const sx = (_v.x * 0.5 + 0.5) * rect.width;
      const sy = (-_v.y * 0.5 + 0.5) * rect.height;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(id);
    }
    this.onSelect(ids, this.shiftAtDown);
  }
}
