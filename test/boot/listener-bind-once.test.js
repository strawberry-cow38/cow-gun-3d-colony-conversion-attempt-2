/**
 * Regression guard for a bot-review claim that save/load was doubling
 * window listeners. The claim was wrong — nothing in the load path
 * reconstructs listener-binding classes — but locking the invariant in
 * stops future regressions (e.g., someone accidentally calling
 * `installKeyboard` from a designator constructor).
 *
 * Static checks over the source: no DOM, no fake ctx, no localStorage dance.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const main = fs.readFileSync(path.join(repoRoot, 'src/main.js'), 'utf8');
const input = fs.readFileSync(path.join(repoRoot, 'src/boot/input.js'), 'utf8');
const hotkeys = fs.readFileSync(path.join(repoRoot, 'src/boot/hotkeys.js'), 'utf8');

/**
 * Every class below owns `window` or `document` listeners that never
 * `removeEventListener`. They must be constructed exactly once at boot —
 * a second construction would leak the full listener set.
 */
const LISTENER_OWNERS = [
  'FirstPersonCamera',
  'SelectionBox',
  'CowSelector',
  'TilePicker',
  'CowMoveCommand',
  'RtsCamera',
  'ChopDesignator',
  'StockpileDesignator',
  'FarmZoneDesignator',
];

describe('listener-owning classes are constructed exactly once', () => {
  for (const name of LISTENER_OWNERS) {
    it(`${name} appears exactly once as \`new ${name}\` in main.js`, () => {
      const hits = main.match(new RegExp(`\\bnew\\s+${name}\\b`, 'g')) ?? [];
      expect(hits.length).toBe(1);
    });
  }
});

describe('save/load path does not register listeners', () => {
  it('installKeyboard is called exactly once from main.js', () => {
    const hits = main.match(/\binstallKeyboard\s*\(/g) ?? [];
    expect(hits.length).toBe(1);
  });

  it('installKeyboard itself registers exactly one global listener', () => {
    const body = sliceFunction(input, 'export function installKeyboard');
    if (!body) throw new Error('function body not found');
    const adds = body.match(/\baddEventListener\s*\(/g) ?? [];
    expect(adds.length).toBe(1);
  });

  it('loadGame does not touch addEventListener', () => {
    const body = sliceFunction(hotkeys, 'async function loadGame');
    if (!body) throw new Error('function body not found');
    expect(body).not.toMatch(/\baddEventListener\b/);
  });

  it('saveGame does not touch addEventListener', () => {
    const body = sliceFunction(hotkeys, 'async function saveGame');
    if (!body) throw new Error('function body not found');
    expect(body).not.toMatch(/\baddEventListener\b/);
  });
});

/**
 * Extract the body of a top-level function declaration by matching braces.
 * Handles nested `{ ... }` (arrow bodies, object literals) correctly.
 *
 * @param {string} src
 * @param {string} header — e.g. `export function installKeyboard` or
 *   `async function loadGame`. Matched as a literal prefix.
 * @returns {string | null}
 */
function sliceFunction(src, header) {
  const start = src.indexOf(header);
  if (start === -1) return null;
  const braceStart = src.indexOf('{', start);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(braceStart, i + 1);
    }
  }
  return null;
}
