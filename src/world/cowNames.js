/**
 * 1000-name pool baked in via Vite's ?raw import. Cow spawns pick from here
 * so the herd feels less like a list of entity ids.
 */

import namesRaw from './cow_names.txt?raw';

const NAMES = namesRaw
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** @returns {string} */
export function pickCowName() {
  if (NAMES.length === 0) return 'cow';
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

export { NAMES as COW_NAMES };
