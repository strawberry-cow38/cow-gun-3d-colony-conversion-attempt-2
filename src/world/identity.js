/**
 * Colonist identity generator. Rolls a full demographic card (gender,
 * birthTick, height, hair color) when a colonist spawns. Framed for humans:
 * the cow phase uses this as-is, and the eventual human conversion only
 * swaps the visual without touching the data.
 *
 * Gender pool excludes 'nonbinary' — that option is reserved for future
 * robot colonists. See memory/project_colony_sim_cows_to_humans.md.
 */

import { randomBirthTickForAge } from '../sim/calendar.js';
import { rollTraits } from './traits.js';

/** @typedef {'male' | 'female' | 'nonbinary'} Gender */

const ADULT_MIN_AGE = 20;
const ADULT_MAX_AGE = 60;

// Human-framed ranges (cm). Rough gender dimorphism that we can re-tune when
// the human visuals land.
const HEIGHT_CM = {
  male: { min: 163, max: 193 },
  female: { min: 150, max: 180 },
  nonbinary: { min: 155, max: 190 },
};

const HAIR_COLORS = [
  '#2b1b10', // black
  '#4a2f20', // dark brown
  '#6b4423', // brown
  '#8a5a2e', // light brown
  '#c99a4a', // dirty blonde
  '#e8c070', // blonde
  '#b33a1e', // red
  '#9c9a94', // salt & pepper
  '#d8d4cc', // silver
];

/**
 * @param {number} currentTick
 * @returns {{ gender: Gender, birthTick: number, heightCm: number, hairColor: string, traits: string[] }}
 */
export function rollCowIdentity(currentTick) {
  const gender = /** @type {Gender} */ (Math.random() < 0.5 ? 'female' : 'male');
  const range = HEIGHT_CM[gender];
  const heightCm = Math.round(range.min + Math.random() * (range.max - range.min));
  const hairColor = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
  const birthTick = randomBirthTickForAge(ADULT_MIN_AGE, ADULT_MAX_AGE, currentTick);
  const traits = rollTraits();
  return { gender, birthTick, heightCm, hairColor, traits };
}

/** @param {Gender} gender */
export function genderSymbol(gender) {
  if (gender === 'male') return '♂';
  if (gender === 'female') return '♀';
  return '⚪';
}
