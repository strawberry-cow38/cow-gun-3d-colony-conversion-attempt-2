/**
 * v14 → v15 migration.
 *
 * Adds farming. `tileGrid.farmZone` holds the player-designated crop at each
 * tile (0 = not farmed, 1=corn, 2=carrot, 3=potato). `tileGrid.tilled` tracks
 * soil worked by cows. Crops themselves live as entities in a new `crops`
 * array — no entries on pre-v15 saves, so every farm zone starts as raw
 * ground that cows will then till and plant.
 */

/** @type {import('./index.js').Migration} */
export const v14_to_v15 = {
  from: 14,
  to: 15,
  run(state) {
    const W = state.tileGrid?.W ?? 0;
    const H = state.tileGrid?.H ?? 0;
    return {
      ...state,
      version: 15,
      tileGrid: {
        ...state.tileGrid,
        farmZone: state.tileGrid?.farmZone ?? new Array(W * H).fill(0),
        tilled: state.tileGrid?.tilled ?? new Array(W * H).fill(0),
      },
      crops: state.crops ?? [],
    };
  },
};
