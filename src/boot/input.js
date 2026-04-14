/**
 * Global keyboard handler. Binds a single keydown listener that fans out
 * through the hotkey table in `./hotkeys.js` — see that file for "what does
 * key X do". Keeping the listener here (with the InputCtx typedef main.js
 * builds) means the surface main.js sees stays a single import.
 */

import { dispatch } from './hotkeys.js';

/**
 * @typedef {Object} BootState
 * @property {boolean} debugEnabled
 * @property {boolean} followEnabled
 * @property {number|null} primaryCow
 * @property {Set<number>} selectedCows
 * @property {{ i: number, j: number } | null} lastPick
 * @property {import('three').Mesh} tileMesh
 * @property {number} [pausedSpeed]  last non-zero speed, restored when space unpauses
 * @property {boolean} [roofsVisible] defaults true; V toggles
 *
 * @typedef {Object} InputCtx
 * @property {import('../ecs/world.js').World} world
 * @property {import('../world/tileGrid.js').TileGrid} tileGrid
 * @property {import('../sim/pathfinding.js').PathCache} pathCache
 * @property {import('../jobs/board.js').JobBoard} jobBoard
 * @property {import('three').Scene} scene
 * @property {any} fpCamera
 * @property {any} rts
 * @property {any} itemInstancer
 * @property {any} treeInstancer
 * @property {any} stockpileOverlay
 * @property {{ markDirty: () => void }} farmZoneOverlay
 * @property {{ markDirty: () => void }} tilledOverlay
 * @property {{ markDirty: () => void } | null} [buildSiteInstancer]
 * @property {{ markDirty: () => void } | null} [wallInstancer]
 * @property {import('../systems/rooms.js').RoomRegistry} rooms
 * @property {{ markDirty: () => void }} roomOverlay
 * @property {{ markDirty: () => void }} ignoreRoofOverlay
 * @property {{ markDirty: () => void }} roofInstancer
 * @property {{ markDirty: () => void }} floorInstancer
 * @property {number} treeCount
 * @property {number} gridW
 * @property {number} gridH
 * @property {BootState} state
 * @property {{ play: (kind: string) => void }} audio
 * @property {import('../world/timeOfDay.js').TimeOfDay} timeOfDay
 * @property {import('../world/weather.js').Weather} weather
 * @property {import('../sim/loop.js').SimLoop} loop
 * @property {() => void} applyDebugVisibility
 * @property {() => void} updateHud
 */

/** @param {InputCtx} ctx */
export function installKeyboard(ctx) {
  addEventListener('keydown', (e) => {
    void dispatch(ctx, e);
  });
}
