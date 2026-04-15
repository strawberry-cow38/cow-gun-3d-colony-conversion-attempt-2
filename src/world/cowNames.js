/**
 * First-name + surname pools baked in via Vite's ?raw import. Cow spawns
 * pick from these so the herd feels less like a list of entity ids.
 */

import namesRaw from './cow_names.txt?raw';
import surnamesRaw from './cow_surnames.txt?raw';

const NAMES = namesRaw
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const SURNAMES = surnamesRaw
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/** @returns {string} */
export function pickCowName() {
  if (NAMES.length === 0) return 'cow';
  return NAMES[Math.floor(Math.random() * NAMES.length)];
}

/** @returns {string} */
export function pickCowSurname() {
  if (SURNAMES.length === 0) return '';
  return SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
}

export { NAMES as COW_NAMES, SURNAMES as COW_SURNAMES };
