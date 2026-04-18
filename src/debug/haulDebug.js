/**
 * Haul debug logging. Gated on `globalThis.__haulDebug` so prod is silent.
 * Enable from the browser console:
 *
 *   __haulDebug = true   // verbose per-failure logs + poster skip reasons
 *   __haulDebug = false  // off
 *
 * Every log carries enough context (cow name, job kind/state, source tile,
 * drop tile, site coords/kind, baseFill, reason) that master can paste the
 * output into a bug report without needing to reproduce with the transcript.
 *
 * Also keeps a ring buffer of the last 64 events on `__haulDebugLog` so a
 * stuck cow can be diagnosed after the fact — `console.table(__haulDebugLog)`
 * from devtools.
 */

const RING_SIZE = 64;
/** @type {Record<string, unknown>[]} */
const ring = [];

function push(entry) {
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
}

/**
 * @param {string} reason   short tag, e.g. 'no-route-to-item', 'site-gone'
 * @param {Record<string, unknown>} ctx
 */
export function logHaulStuck(reason, ctx) {
  const g = /** @type {any} */ (globalThis);
  const entry = { t: Date.now(), reason, ...ctx };
  push(entry);
  g.__haulDebugLog = ring;
  if (g.__haulDebug) {
    console.warn(`[haul:${reason}]`, ctx);
  }
}

/** Hint printed once so master sees how to turn logging on. */
export function printHaulDebugHint() {
  const g = /** @type {any} */ (globalThis);
  if (g.__haulDebugHintShown) return;
  g.__haulDebugHintShown = true;
  console.info(
    '[haul] set `__haulDebug = true` in console for per-failure logs. recent events at `__haulDebugLog`.',
  );
}
