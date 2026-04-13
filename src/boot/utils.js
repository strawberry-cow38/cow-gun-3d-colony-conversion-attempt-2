/**
 * Boot-time helpers. No shared state — pure functions over (world, …).
 */

/**
 * Chunked base64 of a byte array. `btoa(String.fromCharCode(...bytes))` throws
 * `Maximum call stack size exceeded` once `bytes` grows past ~100k because
 * spread passes every element as a separate argument. Chunked path is safe
 * for arbitrarily large buffers.
 * @param {Uint8Array} bytes
 */
export function bytesToBase64(bytes) {
  const chunk = 0x8000;
  let str = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    str += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + chunk)));
  }
  return btoa(str);
}

/** @param {string} b64 */
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {string} component
 */
export function countComp(world, component) {
  let n = 0;
  for (const _ of world.query([component])) n++;
  return n;
}

/**
 * Every cow id in spawn order (what query returns).
 * @param {import('../ecs/world.js').World} world
 * @returns {number[]}
 */
export function allCowIds(world) {
  const ids = [];
  for (const { id } of world.query(['Cow', 'Position'])) ids.push(id);
  return ids;
}

/**
 * @param {import('../ecs/world.js').World} world
 * @param {string} comp
 */
export function despawnAllComp(world, comp) {
  const ids = [];
  for (const { id } of world.query([comp])) ids.push(id);
  for (const id of ids) world.despawn(id);
}
