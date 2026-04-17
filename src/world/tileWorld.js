/**
 * Multi-layer tile container. Today the world is a single `TileGrid` stored
 * as layer 0 — every caller reads `activeZ = 0` and no system writes a
 * non-zero z anywhere. The wrapper exists so future stacked-floor work can
 * grow the `layers` array without rewriting every `grid` callsite again.
 *
 * Keep this file behavior-free: it's a vocabulary introduction, not an
 * abstraction. A TileWorld with one layer behaves exactly like the bare
 * grid did before.
 */

/** @typedef {import('./tileGrid.js').TileGrid} TileGrid */

export class TileWorld {
  /**
   * @param {TileGrid} ground  the z=0 layer
   */
  constructor(ground) {
    /** @type {TileGrid[]} layer index is z; [0] is ground */
    this.layers = [ground];
    /** Currently rendered / interacted-with layer. Always 0 today. */
    this.activeZ = 0;
  }

  /**
   * @param {number} z
   * @returns {TileGrid | undefined}
   */
  getLayer(z) {
    return this.layers[z];
  }

  /** Shorthand for the active layer — matches how callers talk about "the grid" today. */
  get active() {
    return this.layers[this.activeZ];
  }

  /** Layer count (height of the stack). 1 until stacked floors ship. */
  get depth() {
    return this.layers.length;
  }
}
