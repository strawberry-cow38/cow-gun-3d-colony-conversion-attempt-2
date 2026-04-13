/**
 * Fixed-step sim loop with accumulator, decoupled from render.
 *
 * - Sim runs at SIM_HZ (30 Hz per ARCHITECTURE.md §6).
 * - Accumulator collects elapsed real time, drains in fixed dt steps.
 * - On each render frame, exposes `alpha` ∈ [0,1] = fraction into the next
 *   pending sim step. Render uses this to interpolate between previous and
 *   current sim state for visual smoothness.
 * - Caps catch-up at MAX_STEPS_PER_FRAME so a stalled tab doesn't death-spiral.
 *
 * Reference: gaffer-on-games "Fix Your Timestep!" pattern.
 */

export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;
const MAX_STEPS_PER_FRAME = 5;
export const SPEED_STEPS = /** @type {const} */ ([1, 2, 3]);

/**
 * @typedef SimLoopOpts
 * @property {(dt: number, tick: number) => void} step    fixed-step sim work
 * @property {(alpha: number) => void} render            called once per RAF
 * @property {() => number} [now]                        time source (default performance.now)
 */

export class SimLoop {
  /** @param {SimLoopOpts} opts */
  constructor(opts) {
    this.step = opts.step;
    this.render = opts.render;
    this.now = opts.now ?? (() => performance.now());
    this.tick = 0;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    /** Smoothed sim Hz, sampled in render. */
    this.measuredHz = 0;
    /** Steps per render frame, last frame. */
    this.lastSteps = 0;
    /** Tick-rate multiplier. 1 = normal 30Hz, 2 = 60Hz, 3 = 90Hz. */
    this.speed = 1;
    /** @type {number | null} */
    this.rafId = null;
  }

  /** @param {number} mult */
  setSpeed(mult) {
    this.speed = mult;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = this.now();
    const tickWindow = [];
    const frame = () => {
      if (!this.running) return;
      const t = this.now();
      let frameTime = (t - this.lastTime) / 1000;
      if (frameTime > 0.25) frameTime = 0.25;
      this.lastTime = t;
      // Speed multiplier is applied to the accumulator so higher speeds just
      // drain more sim ticks per render frame. Same SIM_DT everywhere keeps
      // per-tick math (hunger drain, chop ticks, etc.) untouched.
      this.accumulator += frameTime * this.speed;

      // Scale the catch-up cap with speed so 3x doesn't starve at busy tabs.
      const maxSteps = MAX_STEPS_PER_FRAME * Math.max(1, Math.ceil(this.speed));
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < maxSteps) {
        this.step(SIM_DT, this.tick);
        this.tick++;
        this.accumulator -= SIM_DT;
        steps++;
        tickWindow.push(t);
      }
      this.lastSteps = steps;

      while (tickWindow.length > 0 && t - tickWindow[0] > 1000) tickWindow.shift();
      this.measuredHz = tickWindow.length;

      const alpha = this.accumulator / SIM_DT;
      this.render(alpha);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
