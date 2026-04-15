/**
 * v25 → v26 migration.
 *
 * Adds the Identity component to every cow. Old saves have no demographic
 * data — back-fill with a random-but-stable roll per cow so each reload
 * looks the same as the last.
 *
 * birthTick defaults to 0 (epoch = Jan 1 2000 08:00). That lands everyone
 * at ~0 years old until the sim advances; we bias it so migrated colonists
 * read as 20–60 years old immediately by rolling a pre-epoch negative tick.
 */

const HAIR_COLORS = [
  '#2b1b10',
  '#4a2f20',
  '#6b4423',
  '#8a5a2e',
  '#c99a4a',
  '#e8c070',
  '#b33a1e',
  '#9c9a94',
  '#d8d4cc',
];
const HEIGHT_CM = {
  male: { min: 163, max: 193 },
  female: { min: 150, max: 180 },
};
const MS_PER_DAY = 86_400_000;
const SIM_MS_PER_TICK = 2000;
const DAYS_PER_YEAR = 365.25;

/** @type {import('./index.js').Migration} */
export const v25_to_v26 = {
  from: 25,
  to: 26,
  run(state) {
    const cows = Array.isArray(state.cows) ? state.cows : [];
    const upgradedCows = cows.map((/** @type {any} */ c) => {
      if (c.identity) return c;
      const gender = Math.random() < 0.5 ? 'female' : 'male';
      const range = HEIGHT_CM[/** @type {'male' | 'female'} */ (gender)];
      const heightCm = Math.round(range.min + Math.random() * (range.max - range.min));
      const hairColor = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
      const ageYears = 20 + Math.random() * 40;
      const birthTick = Math.floor(-(ageYears * DAYS_PER_YEAR * MS_PER_DAY) / SIM_MS_PER_TICK);
      return {
        ...c,
        identity: { gender, birthTick, heightCm, hairColor },
      };
    });
    return { ...state, version: 26, cows: upgradedCows };
  },
};
