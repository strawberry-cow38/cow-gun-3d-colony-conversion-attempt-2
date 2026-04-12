/**
 * v0 → v1 migration.
 *
 * v0 was an early-development format that never shipped — kept here as the
 * canonical example shape so future migrations have a template. v0 stored a
 * single `tiles: number[]` flat array of elevations; v1 splits into
 * `elevation: number[]` and adds `biome: number[]`.
 */

/** @type {import('./index.js').Migration} */
export const v0_to_v1 = {
  from: 0,
  to: 1,
  run(state) {
    const tiles = Array.isArray(state.tiles) ? state.tiles : [];
    return {
      ...state,
      version: 1,
      tileGrid: {
        W: state.W ?? 0,
        H: state.H ?? 0,
        elevation: tiles,
        biome: tiles.map(() => 0),
      },
      tiles: undefined,
    };
  },
};
