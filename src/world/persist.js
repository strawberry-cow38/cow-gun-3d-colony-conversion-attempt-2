/**
 * Save / load: serialize world state to JSON, gzip it on the wire and at rest.
 *
 * Format (v1):
 * {
 *   version: 1,
 *   tileGrid: { W, H, elevation: number[], biome: number[] }
 * }
 *
 * Browser uses CompressionStream('gzip'). Node tests use zlib.
 *
 * On load, runs the migration chain (see ./migrations/index.js) so old saves
 * always upgrade cleanly.
 */

import { CURRENT_VERSION, runMigrations } from './migrations/index.js';
import { TileGrid } from './tileGrid.js';

/**
 * @param {TileGrid} tileGrid
 */
export function serializeState(tileGrid) {
  return {
    version: CURRENT_VERSION,
    tileGrid: {
      W: tileGrid.W,
      H: tileGrid.H,
      elevation: Array.from(tileGrid.elevation),
      biome: Array.from(tileGrid.biome),
    },
  };
}

/**
 * @param {{ version: number, tileGrid: { W: number, H: number, elevation: number[], biome: number[] } }} state
 */
export function hydrateTileGrid(state) {
  const tg = new TileGrid(state.tileGrid.W, state.tileGrid.H);
  tg.elevation.set(state.tileGrid.elevation);
  tg.biome.set(state.tileGrid.biome);
  return tg;
}

/**
 * Migrate a parsed save state up to CURRENT_VERSION and return it as the
 * current schema shape.
 * @param {{ version: number, [k: string]: any }} parsed
 * @returns {{ version: number, tileGrid: { W: number, H: number, elevation: number[], biome: number[] } }}
 */
export function loadState(parsed) {
  return /** @type {any} */ (runMigrations(parsed));
}

/**
 * Gzip a string using the browser's CompressionStream API.
 * @param {string} json
 * @returns {Promise<Uint8Array>}
 */
export async function gzipString(json) {
  const encoder = new TextEncoder();
  const stream = new Blob([/** @type {BlobPart} */ (encoder.encode(json))]).stream();
  const gz = stream.pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(gz).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Gunzip bytes back to a string.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function gunzipBytes(bytes) {
  const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream();
  const ds = stream.pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(ds).arrayBuffer();
  return new TextDecoder().decode(buf);
}
