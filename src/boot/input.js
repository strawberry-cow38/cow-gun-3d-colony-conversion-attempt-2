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
 * @property {Set<number>} selectedItems
 * @property {Set<number>} selectedFurnaces
 * @property {number|null} primaryFurnace
 * @property {Set<number>} selectedEasels
 * @property {number|null} primaryEasel
 * @property {Set<number>} selectedStoves
 * @property {number|null} primaryStove
 * @property {Set<number>} selectedBeds
 * @property {number|null} primaryBed
 * @property {Set<number>} selectedObjects
 * @property {number|null} primaryObject
 * @property {{ i: number, j: number } | null} lastPick
 * @property {import('three').Mesh} tileMesh
 * @property {import('three').Mesh | null} [waterMesh]
 *   translucent surface plane over DEEP_WATER tiles at Y=0. Rebuilt on load
 *   alongside tileMesh so lakes stay see-through after restoring a save.
 * @property {number} [pausedSpeed]  last non-zero speed, restored when space unpauses
 * @property {boolean} [roofsVisible] defaults true; V toggles
 * @property {number} [tickOffset]   debug-scrubbed ticks added to sim clock (T/Shift+T)
 *
 * @typedef {Object} InputCtx
 * @property {import('../ecs/world.js').World} world
 * @property {import('../world/tileGrid.js').TileGrid} tileGrid
 * @property {import('../world/tileWorld.js').TileWorld} [tileWorld]
 * @property {((z: number) => void)} [setActiveZ]
 *   Q/E fallback hotkey routes through this when no camera/follow consumer
 *   claims the key. Bumps tileWorld.activeZ and lifts the orbit focus.
 * @property {import('../sim/pathfinding.js').PathCache} pathCache
 * @property {import('../jobs/board.js').JobBoard} jobBoard
 * @property {import('three').Scene} scene
 * @property {any} fpCamera
 * @property {any} rts
 * @property {any} itemInstancer
 * @property {{ markDirty: () => void }} itemSelectionViz
 * @property {any} treeInstancer
 * @property {any} boulderInstancer
 * @property {any} stockpileOverlay
 * @property {{ markDirty: () => void }} farmZoneOverlay
 * @property {{ markDirty: () => void }} tilledOverlay
 * @property {{ markDirty: () => void } | null} [buildSiteInstancer]
 * @property {{ markDirty: () => void } | null} [wallInstancer]
 * @property {{ markDirty: () => void }} cropInstancer
 * @property {{ markDirty: () => void } | null} [furnaceInstancer]
 * @property {{ markDirty: () => void } | null} [wallArtInstancer]
 * @property {import('../systems/rooms.js').RoomRegistry} rooms
 * @property {{ markDirty: () => void }} roomOverlay
 * @property {{ markDirty: () => void }} ignoreRoofOverlay
 * @property {{ markDirty: () => void }} roofInstancer
 * @property {{ markDirty: () => void }} floorInstancer
 * @property {{ markDirty: () => void } | null} [flowerInstancer]
 * @property {{ markFlowersDirty: () => void } | null} [ambientParticles]
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
 * @property {{ runKey: (code: string) => boolean }} [objectPanel]
 *   click-selection order dispatcher. Hotkeys (B/C/X/L/Y/F) fall through to
 *   this when the world has objects selected so a keybind fires the same
 *   path as clicking the panel button.
 * @property {import('../render/buildTab.js').BuildTabApi} buildTab
 *   build palette API — hotkeys call toggleOpen / openCategory / activateEntry
 *   so B, the category letters, and per-buildable letters all route through
 *   the same UI state the buttons manipulate.
 */

/** @param {InputCtx} ctx */
export function installKeyboard(ctx) {
  addEventListener('keydown', (e) => {
    void dispatch(ctx, e);
  });
}
