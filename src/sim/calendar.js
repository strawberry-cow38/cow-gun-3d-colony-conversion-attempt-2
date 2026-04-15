/**
 * Sim calendar — tick ↔ human-readable sim date.
 *
 * Sim runs at 30 Hz. One real minute = one sim hour (24 real min = 24 sim hr),
 * so 1 tick = 2 sim seconds. Everything downstream of the tick counter (sun,
 * HUD, ageing) scales with speed automatically.
 *
 * Epoch: Jan 1 2000 08:00 UTC. Negative ticks are valid — used to back-date
 * colonist birthdays before the colony starts.
 */

export const SIM_EPOCH_MS = Date.UTC(2000, 0, 1, 8, 0, 0);
export const SIM_MS_PER_TICK = 2000;
export const TICKS_PER_SIM_MINUTE = 30;
export const TICKS_PER_SIM_HOUR = 1800;
export const TICKS_PER_SIM_DAY = 43200;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** @param {number} tick */
export function tickToSimDate(tick) {
  return new Date(SIM_EPOCH_MS + tick * SIM_MS_PER_TICK);
}

/**
 * Normalized time-of-day, 0..1 where 0 = midnight, 0.5 = noon. Matches the
 * `t` used by timeOfDay.js so the sun can be driven directly from the tick.
 *
 * @param {number} tick
 */
export function dayFractionOfTick(tick) {
  const secs = (tick * SIM_MS_PER_TICK) / 1000;
  const dayFrac = (secs / 86400) % 1;
  // epoch is 08:00, not midnight — offset so t=0 still means midnight.
  const t = (dayFrac + 8 / 24) % 1;
  return (t + 1) % 1;
}

/**
 * Whole sim years between two ticks, rounded down. Used for colonist age.
 * @param {number} birthTick
 * @param {number} currentTick
 */
export function ageYears(birthTick, currentTick) {
  const birth = tickToSimDate(birthTick);
  const now = tickToSimDate(currentTick);
  let years = now.getUTCFullYear() - birth.getUTCFullYear();
  const bm = birth.getUTCMonth();
  const nm = now.getUTCMonth();
  if (nm < bm || (nm === bm && now.getUTCDate() < birth.getUTCDate())) years--;
  return years;
}

/** @param {Date} date */
export function formatSimTime(date) {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** @param {Date} date */
export function formatSimDate(date) {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** @param {Date} date */
export function formatSimBirthday(date) {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Roll a birthTick such that, at `currentTick`, the colonist's age lands in
 * [minYears, maxYears]. The returned tick is typically negative (pre-epoch).
 *
 * @param {number} minYears
 * @param {number} maxYears
 * @param {number} currentTick
 */
export function randomBirthTickForAge(minYears, maxYears, currentTick) {
  const nowMs = SIM_EPOCH_MS + currentTick * SIM_MS_PER_TICK;
  const minMs = nowMs - maxYears * DAYS_PER_YEAR * MS_PER_DAY;
  const maxMs = nowMs - minYears * DAYS_PER_YEAR * MS_PER_DAY;
  const ms = minMs + Math.random() * (maxMs - minMs);
  return Math.floor((ms - SIM_EPOCH_MS) / SIM_MS_PER_TICK);
}
