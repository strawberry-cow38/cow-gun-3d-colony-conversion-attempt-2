/**
 * v12 → v13 migration.
 *
 * Adds the "stuff" (material) system. BuildSite, Wall, Door, and Roof each
 * gain a `stuff` field identifying the material. Pre-v13 saves predate the
 * registry, so every existing structure is defaulted to 'wood' to match the
 * old single-material behavior.
 */

/**
 * @param {any[] | undefined} arr
 */
function defaultStuff(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((entry) => ({ ...entry, stuff: entry.stuff ?? 'wood' }));
}

/** @type {import('./index.js').Migration} */
export const v12_to_v13 = {
  from: 12,
  to: 13,
  run(state) {
    return {
      ...state,
      version: 13,
      buildSites: defaultStuff(state.buildSites),
      walls: defaultStuff(state.walls),
      doors: defaultStuff(state.doors),
      roofs: defaultStuff(state.roofs),
    };
  },
};
