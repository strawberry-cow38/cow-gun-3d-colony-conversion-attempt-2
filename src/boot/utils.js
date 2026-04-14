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
 * Flip `forbidden` across every stack in `ids`. If any stack isn't yet
 * forbidden, forbid them all; otherwise allow them all. Returns the new
 * boolean state so the caller can drive UI/audio off it.
 *
 * @param {import('../ecs/world.js').World} world
 * @param {Iterable<number>} ids
 * @returns {boolean | null}  new state, or null if the selection was empty
 */
export function toggleForbiddenOnStacks(world, ids) {
  let anyUnforbidden = false;
  let any = false;
  for (const id of ids) {
    const item = world.get(id, 'Item');
    if (!item) continue;
    any = true;
    if (item.forbidden !== true) {
      anyUnforbidden = true;
      break;
    }
  }
  if (!any) return null;
  const target = anyUnforbidden;
  for (const id of ids) {
    const item = world.get(id, 'Item');
    if (item) item.forbidden = target;
  }
  return target;
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
