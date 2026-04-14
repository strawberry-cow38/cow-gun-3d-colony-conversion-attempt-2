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
import { v1_to_v2 } from './v1_to_v2.js';
import { v2_to_v3 } from './v2_to_v3.js';
import { v3_to_v4 } from './v3_to_v4.js';
import { v4_to_v5 } from './v4_to_v5.js';
import { v5_to_v6 } from './v5_to_v6.js';
import { v6_to_v7 } from './v6_to_v7.js';
import { v7_to_v8 } from './v7_to_v8.js';
import { v8_to_v9 } from './v8_to_v9.js';
import { v9_to_v10 } from './v9_to_v10.js';
import { v10_to_v11 } from './v10_to_v11.js';
import { v11_to_v12 } from './v11_to_v12.js';
import { v12_to_v13 } from './v12_to_v13.js';
import { v13_to_v14 } from './v13_to_v14.js';

export const CURRENT_VERSION = 14;

/**
 * @typedef Migration
 * @property {number} from
 * @property {number} to
 * @property {(state: any) => any} run
 */

/** @type {Migration[]} */
export const migrations = [
  v0_to_v1,
  v1_to_v2,
  v2_to_v3,
  v3_to_v4,
  v4_to_v5,
  v5_to_v6,
  v6_to_v7,
  v7_to_v8,
  v8_to_v9,
  v9_to_v10,
  v10_to_v11,
  v11_to_v12,
  v12_to_v13,
  v13_to_v14,
];

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
