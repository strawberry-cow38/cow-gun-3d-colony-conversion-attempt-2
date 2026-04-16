/**
 * v35 → v36 migration.
 *
 * Adds the `skills` field to each cow. Legacy saves have no per-cow skill data
 * — rolls a fresh `Skills` payload from the cow's existing childhood/profession
 * and birthTick so load-then-continue plays like the colonist has lived their
 * backstory. Unknown childhood/profession strings fall through to the no-bonus
 * default, which still rolls the small age-creep + gaussian baseline.
 */

import { ageYears } from '../../sim/calendar.js';
import { skillsForChildhood, skillsForProfession } from '../backstories.js';
import { rollStartingSkills } from '../skills.js';

/** @type {import('./index.js').Migration} */
export const v35_to_v36 = {
  from: 35,
  to: 36,
  run(state) {
    const currentTick = state.currentTick ?? 0;
    const cows = Array.isArray(state.cows) ? state.cows : [];
    return {
      ...state,
      version: 36,
      cows: cows.map((c) => {
        if (c.skills) return c;
        const skills = rollStartingSkills({
          ageYears: ageYears(c.identity?.birthTick ?? 0, currentTick),
          childhoodBonus: skillsForChildhood(c.identity?.childhood ?? ''),
          professionBonus: skillsForProfession(c.identity?.profession ?? ''),
        });
        return { ...c, skills };
      }),
    };
  },
};
