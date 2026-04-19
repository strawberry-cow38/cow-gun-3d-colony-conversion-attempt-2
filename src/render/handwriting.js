/**
 * Render a colonist name as plain text into a container element. Paired with
 * `nameFontFor(traits)` CSS so the chosen handwriting face still reads, just
 * without the per-glyph scale/rotation jitter that made long names hard to
 * parse at a glance.
 */

/**
 * @param {HTMLElement} el
 * @param {string} name
 */
export function writeName(el, name) {
  el.textContent = name;
}
