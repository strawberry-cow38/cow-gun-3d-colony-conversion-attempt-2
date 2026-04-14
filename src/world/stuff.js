/**
 * Material ("stuff") registry for buildables. One entry per material; each
 * structure renderer looks up its color here based on the entity's `stuff`
 * field, so adding a new material means adding one registry entry plus
 * source items — no per-renderer edit.
 *
 * `itemKind` is the inventory-item kind hauled to BuildSites of that material
 * (must exist in src/world/items.js ITEM_KINDS). Structure colors vary per
 * kind because doors/roofs/walls read different shades of the same material.
 */

/**
 * @typedef {Object} StuffDef
 * @property {string} id
 * @property {string} name             display string for UI labels
 * @property {string} itemKind         item kind required at the BuildSite
 * @property {number} wallColor        wallInstancer + roofInstancer (wall-supported)
 * @property {number} doorSlabColor    doorInstancer — moving panel
 * @property {number} doorFrameColor   doorInstancer — surrounding jamb
 * @property {number} roofColor        roofInstancer — supported-roof tint
 * @property {number} blueprintTint    buildSiteInstancer — mixed into waiting-color
 */

/** @type {Record<string, StuffDef>} */
export const STUFF = {
  wood: {
    id: 'wood',
    name: 'Wood',
    itemKind: 'wood',
    wallColor: 0x8a5a2b,
    doorSlabColor: 0xb87333,
    doorFrameColor: 0x8a5a2b,
    roofColor: 0x8a5a2b,
    blueprintTint: 0xb8864a,
  },
  stone: {
    id: 'stone',
    name: 'Stone',
    itemKind: 'stone',
    wallColor: 0x7a7a7a,
    doorSlabColor: 0x8a8a8a,
    doorFrameColor: 0x6a6a6a,
    roofColor: 0x8a8a8a,
    blueprintTint: 0x9aa0a6,
  },
};

/**
 * Ordered list — stuff picker cycles through in this order so the button
 * hint / tab-switch affordance is deterministic. Extending the palette:
 * append to this list AND add the item kind to items.js.
 */
export const STUFF_ORDER = /** @type {const} */ (['wood', 'stone']);

export const DEFAULT_STUFF = 'wood';

/**
 * @param {string | undefined | null} id
 * @returns {StuffDef}
 */
export function getStuff(id) {
  return STUFF[id ?? DEFAULT_STUFF] ?? STUFF[DEFAULT_STUFF];
}
