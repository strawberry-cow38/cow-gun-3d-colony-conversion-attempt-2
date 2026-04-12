/**
 * Save migration registry. ARCHITECTURE.md §5 says migrations are
 * APPEND-ONLY — never delete one once shipped. Year-old saves must always
 * load.
 *
 * `CURRENT_VERSION` is the version this build emits. Each entry in
 * `migrations` upgrades a state from version N → N+1. To bump the format:
 *   1. Increment CURRENT_VERSION
 *   2. Append a new migration `vN_to_v(N+1)`
 *   3. Add a roundtrip test for an old save
 */

import { v0_to_v1 } from './v0_to_v1.js';

export const CURRENT_VERSION = 1;

/**
 * @typedef Migration
 * @property {number} from
 * @property {number} to
 * @property {(state: any) => any} run
 */

/** @type {Migration[]} */
export const migrations = [v0_to_v1];

/**
 * Apply every migration whose `from` is >= save.version, in order, until the
 * state reaches CURRENT_VERSION. Throws if there's a gap.
 * @param {{ version: number, [k: string]: any }} state
 */
export function runMigrations(state) {
  let s = state;
  while (s.version < CURRENT_VERSION) {
    const m = migrations.find((mig) => mig.from === s.version);
    if (!m) throw new Error(`no migration from version ${s.version}`);
    s = m.run(s);
    s.version = m.to;
  }
  if (s.version !== CURRENT_VERSION) {
    throw new Error(`migrations did not reach CURRENT_VERSION ${CURRENT_VERSION}`);
  }
  return s;
}
