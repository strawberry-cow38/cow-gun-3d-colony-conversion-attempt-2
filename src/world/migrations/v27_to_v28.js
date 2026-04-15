/**
 * v27 → v28 migration.
 *
 * Extends colonist Identity with `firstName`, `surname`, `title`. Old saves
 * had a single `name` + no honorific; we treat the old name as firstName,
 * roll a surname + title, and rewrite the display name so the full UI
 * string ("Dr. Bessie Moonfield") shows up consistently after load.
 */

// Inline surname pool — migrations shouldn't depend on mutable app data.
// This is a representative slice; new cows use the full pool in
// world/cow_surnames.txt.
const SURNAMES = [
  'Moonfield',
  'Pasture',
  'Holstein',
  'Angus',
  'Jersey',
  'Guernsey',
  'Hereford',
  'Highland',
  'Meadow',
  'Grassfield',
  'Cloverhollow',
  'Hayfield',
  'Butterworth',
  'Creamley',
  'Milkridge',
  'Udderton',
  'Hoofman',
  'Mooford',
  'Blackwell',
  'Whitmore',
  'Thornwood',
  'Starmoor',
  'Daisyfield',
  'Greenacre',
  'Willowbrook',
  'Honeycomb',
  'Ironbark',
  'Oakmoss',
  'Longhorn',
  'Bellwether',
];

/** @param {'male' | 'female' | 'nonbinary'} gender */
function rollTitle(gender) {
  const r = Math.random();
  if (r < 0.03) return 'Prof.';
  if (r < 0.1) return 'Dr.';
  if (r < 0.12) return 'Col.';
  if (gender === 'male') return 'Mr.';
  if (gender === 'female') return Math.random() < 0.5 ? 'Mrs.' : 'Ms.';
  return 'Mx.';
}

/** @type {import('./index.js').Migration} */
export const v27_to_v28 = {
  from: 27,
  to: 28,
  run(state) {
    const cows = Array.isArray(state.cows) ? state.cows : [];
    const upgradedCows = cows.map((/** @type {any} */ c) => {
      if (!c.identity) return c;
      if (c.identity.firstName && c.identity.title) return c;
      const firstName = c.identity.firstName ?? c.name ?? 'cow';
      const surname = c.identity.surname ?? SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
      const title = c.identity.title ?? rollTitle(c.identity.gender);
      const composed = `${title} ${firstName}${surname ? ` ${surname}` : ''}`;
      return {
        ...c,
        name: composed,
        identity: { ...c.identity, firstName, surname, title },
      };
    });
    return { ...state, version: 28, cows: upgradedCows };
  },
};
