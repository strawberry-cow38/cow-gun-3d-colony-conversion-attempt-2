/**
 * Build a chunked terrain mesh from a TileGrid.
 *
 * Each tile gets its own 4 top vertices (no sharing) so per-tile biome color
 * has hard boundaries (rimworld-style) instead of blending at corners. For
 * every tile edge whose cross-grid neighbor sits lower (or is out of bounds),
 * a vertical cliff quad is emitted dropping from the tile's top Y down to the
 * neighbor's top (or 0 at the boundary). That keeps the stepped heightmap
 * visually solid — no void behind the cliff.
 *
 * The full grid is split into fixed-size CHUNK_TILES×CHUNK_TILES submeshes
 * parented under a single Group. Three's frustum culler descends into the
 * Group and tests each chunk's bounding sphere independently, so looking at
 * the sky or staring down at a small region only renders a few chunks worth
 * of triangles instead of the whole map (40k+ tris). Raycasts against the
 * Group with `recursive: true` get the same benefit — each chunk's sphere
 * rejects before any triangle walk.
 *
 * Chunk geometry is standalone (no shared vertices across chunk seams) so
 * chunk-level repair could work later; for now rebuilds are full-group via
 * `disposeTileMesh` + a fresh `buildTileMesh`.
 */

import * as THREE from 'three';
import { TILE_SIZE } from '../world/coords.js';
import { BIOME, SKIRT_TILES, TERRAIN_STEP } from '../world/tileGrid.js';

// Water surface visually sits 6/8 (= 3/4) of a terrain step above ground level
// — high enough that shallow-water tiles read as a wadeable sandy bed under a
// thin layer of water, low enough that a single quarter-wall placed in shallow
// water still pokes above the surface.
const WATER_SURFACE_Y = (TERRAIN_STEP * 6) / 8;

const SAND_TOP_COLOR = new THREE.Color(0xc8b27a);
const SAND_CLIFF_COLOR = new THREE.Color(0xc8b27a);

// 32×32 tiles per chunk → 49 chunks on a 200×200 map (plus a handful for
// the skirt ring). Each chunk ~1k top quads + cliffs = small enough that
// partial-camera views cull most of the world, large enough that we don't
// blow the draw-call budget on chunk overhead.
const CHUNK_TILES = 32;

// Shallow water tiles render as their sandy bed — the actual water is the
// translucent surface mesh built in buildWaterSurface, so the bed reads
// through it as wet sand rather than an opaque blue tile.
const BIOME_COLORS = {
  [BIOME.GRASS]: new THREE.Color(0x3a7a3a),
  [BIOME.DIRT]: new THREE.Color(0x6b4f2a),
  [BIOME.STONE]: new THREE.Color(0x6a6e74),
  [BIOME.SAND]: SAND_TOP_COLOR,
  [BIOME.SHALLOW_WATER]: SAND_TOP_COLOR,
  [BIOME.DEEP_WATER]: new THREE.Color(0x2a5a8c),
};

// Cliff faces are coloured per biome so stone tiles expose grey rock, sand
// shows sand, and water tiles keep their water tint through the cliff. Grass
// and dirt default to a warm earth brown — they're meant to read as exposed
// subsoil rather than "green wall" / "brown wall". Values are intentionally
// bright-ish so horizontal normals (which barely pick up the hemisphere
// light's ground term) still read as a colour rather than pure black.
const CLIFF_COLORS = {
  [BIOME.GRASS]: new THREE.Color(0x8a6b48),
  [BIOME.DIRT]: new THREE.Color(0x8a6b48),
  [BIOME.STONE]: new THREE.Color(0x7a7e84),
  [BIOME.SAND]: SAND_CLIFF_COLOR,
  [BIOME.SHALLOW_WATER]: SAND_CLIFF_COLOR,
  [BIOME.DEEP_WATER]: new THREE.Color(0x2a5a8c),
};
const DEFAULT_CLIFF = CLIFF_COLORS[BIOME.GRASS];

/**
 * Returns a Group of chunk Meshes. Callers add it to the scene with
 * `scene.add(group)` and pass it to `Raycaster.intersectObject(group, true)`
 * (the `true` is mandatory now — the returned object is a Group, not a Mesh).
 *
 * @param {import('../world/tileGrid.js').TileGrid} tileGrid
 * @returns {THREE.Group}
 */
export function buildTileMesh(tileGrid) {
  const { W, H } = tileGrid;
  // When `hasSkirt` is set, the renderer walks a ring of SKIRT_TILES beyond
  // the playable grid so lakes / hills don't terminate in a sharp line at
  // the map edge. Picking + pathing still clamp to the inner W×H.
  const skirted = tileGrid.hasSkirt === true;
  const S = skirted ? SKIRT_TILES : 0;
  const iMin = -S;
  const iMax = W + S;
  const jMin = -S;
  const jMax = H + S;
  const halfW = (W * TILE_SIZE) / 2;
  const halfH = (H * TILE_SIZE) / 2;

  const getElev = skirted
    ? (i, j) => tileGrid.getSkirtElevation(i, j)
    : (i, j) => tileGrid.getElevation(i, j);
  const getBiome = skirted
    ? (i, j) => tileGrid.getSkirtBiome(i, j)
    : (i, j) => tileGrid.getBiome(i, j);

  // One shared material across chunks — identical uniforms, only geometry
  // differs per chunk, so Three batches shader setup across the draw calls.
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0,
    roughness: 1,
  });

  const group = new THREE.Group();
  group.name = 'terrain';

  for (let cj0 = jMin; cj0 < jMax; cj0 += CHUNK_TILES) {
    const cj1 = Math.min(cj0 + CHUNK_TILES, jMax);
    for (let ci0 = iMin; ci0 < iMax; ci0 += CHUNK_TILES) {
      const ci1 = Math.min(ci0 + CHUNK_TILES, iMax);
      const mesh = buildChunkMesh(
        ci0,
        ci1,
        cj0,
        cj1,
        iMin,
        iMax,
        jMin,
        jMax,
        halfW,
        halfH,
        getElev,
        getBiome,
        material,
      );
      if (mesh) group.add(mesh);
    }
  }
  return group;
}

/**
 * Dispose every chunk's geometry. Call before dropping a terrain Group so
 * GPU buffers are released; the shared material stays alive on the caller's
 * side if they're about to rebuild (cheap to recreate, but disposed here for
 * symmetry with the old `mesh.geometry.dispose()` pattern).
 *
 * @param {THREE.Group} group
 */
export function disposeTileMesh(group) {
  for (const child of group.children) {
    const mesh = /** @type {THREE.Mesh} */ (child);
    mesh.geometry.dispose();
  }
  const firstMesh = /** @type {THREE.Mesh | undefined} */ (group.children[0]);
  if (firstMesh) {
    const mat = /** @type {THREE.Material} */ (firstMesh.material);
    mat.dispose();
  }
}

/**
 * Build one chunk mesh over the sub-rect [i0, i1) × [j0, j1). Cliff edge
 * checks use the global `iMin/iMax/jMin/jMax` so cliffs at the outer map
 * border drop to Y=0 (not to the neighboring chunk's in-bounds tile).
 */
function buildChunkMesh(
  i0,
  i1,
  j0,
  j1,
  iMin,
  iMax,
  jMin,
  jMax,
  halfW,
  halfH,
  getElev,
  getBiome,
  material,
) {
  const tileCount = (i1 - i0) * (j1 - j0);
  // Worst case: every tile has 4 neighbors lower than itself → 4 cliff quads.
  const maxVerts = tileCount * (4 + 4 * 4);
  const maxIdx = tileCount * (6 + 4 * 6);
  const positions = new Float32Array(maxVerts * 3);
  const colors = new Float32Array(maxVerts * 3);
  const indices = new Uint32Array(maxIdx);

  let v = 0;
  let ix = 0;

  const pushCliff = (ax, az, bx, bz, topY, bottomY, r, g, b) => {
    const baseV = v / 3;
    positions[v++] = ax;
    positions[v++] = topY;
    positions[v++] = az;
    positions[v++] = bx;
    positions[v++] = topY;
    positions[v++] = bz;
    positions[v++] = bx;
    positions[v++] = bottomY;
    positions[v++] = bz;
    positions[v++] = ax;
    positions[v++] = bottomY;
    positions[v++] = az;
    for (let k = 0; k < 4; k++) {
      const o = (baseV + k) * 3;
      colors[o] = r;
      colors[o + 1] = g;
      colors[o + 2] = b;
    }
    indices[ix++] = baseV;
    indices[ix++] = baseV + 1;
    indices[ix++] = baseV + 2;
    indices[ix++] = baseV;
    indices[ix++] = baseV + 2;
    indices[ix++] = baseV + 3;
  };

  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const x0 = i * TILE_SIZE - halfW;
      const x1 = x0 + TILE_SIZE;
      const z0 = j * TILE_SIZE - halfH;
      const z1 = z0 + TILE_SIZE;
      const y = getElev(i, j);

      const baseV = v / 3;
      positions[v++] = x0;
      positions[v++] = y;
      positions[v++] = z0;
      positions[v++] = x1;
      positions[v++] = y;
      positions[v++] = z0;
      positions[v++] = x1;
      positions[v++] = y;
      positions[v++] = z1;
      positions[v++] = x0;
      positions[v++] = y;
      positions[v++] = z1;

      const biome = getBiome(i, j);
      const base = BIOME_COLORS[biome] || BIOME_COLORS[BIOME.GRASS];
      const topShade = 1 + Math.max(-0.25, Math.min(0.25, y / 60));
      const tr = base.r * topShade;
      const tg = base.g * topShade;
      const tb = base.b * topShade;
      for (let k = 0; k < 4; k++) {
        const o = (baseV + k) * 3;
        colors[o] = tr;
        colors[o + 1] = tg;
        colors[o + 2] = tb;
      }

      // Counter-clockwise winding when viewed from above (+Y) so normals
      // face up and the mesh is visible from the camera, not just from below.
      indices[ix++] = baseV;
      indices[ix++] = baseV + 2;
      indices[ix++] = baseV + 1;
      indices[ix++] = baseV;
      indices[ix++] = baseV + 3;
      indices[ix++] = baseV + 2;

      // Out-of-bounds neighbors drop to Y=0 (the water plane). Same-or-higher
      // neighbors get skipped — their own face will cover it when rendered.
      const cliff = CLIFF_COLORS[biome] || DEFAULT_CLIFF;
      const cr = cliff.r;
      const cg = cliff.g;
      const cb = cliff.b;
      const yW = i > iMin ? getElev(i - 1, j) : 0;
      const yE = i < iMax - 1 ? getElev(i + 1, j) : 0;
      const yN = j > jMin ? getElev(i, j - 1) : 0;
      const yS = j < jMax - 1 ? getElev(i, j + 1) : 0;
      if (yW < y) pushCliff(x0, z1, x0, z0, y, yW, cr, cg, cb);
      if (yE < y) pushCliff(x1, z0, x1, z1, y, yE, cr, cg, cb);
      if (yN < y) pushCliff(x0, z0, x1, z0, y, yN, cr, cg, cb);
      if (yS < y) pushCliff(x1, z1, x0, z1, y, yS, cr, cg, cb);
    }
  }

  if (v === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, v), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, v), 3));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, ix), 1));
  geometry.computeVertexNormals();
  // Explicit bounding sphere so Three's frustum culler has real bounds from
  // the first frame instead of falling back to "always visible".
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

// Depth tint palette. Tile "depth" is the Chebyshev distance from shore
// (0 = foam ring on adjacent sand, 1 = water tile touching shore, grows
// toward the interior). Below the palette endpoints we linearly interpolate
// between `FOAM → SHALLOW` for depth 0→1 and `SHALLOW → DEEP` for depth
// 1→DEEP_AT. Past DEEP_AT the color clamps to `DEEP`. RGBA so we can vary
// opacity per tile — foam is nearly opaque whitish, shallow edges are
// mostly clear pale teal, open water is darker and a little thicker.
const FOAM_RGBA = [0.72, 0.86, 0.95, 0.5];
const SHALLOW_RGBA = [0.22, 0.52, 0.82, 0.72];
const DEEP_RGBA = [0.04, 0.18, 0.48, 0.92];
const DEEP_AT = 8;

/** @param {number[]} a @param {number[]} b @param {number} t */
function lerpRgba(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

/** @param {number} depth */
function waterColorForDepth(depth) {
  if (depth <= 0) return FOAM_RGBA;
  if (depth >= DEEP_AT) return DEEP_RGBA;
  if (depth <= 1) return lerpRgba(FOAM_RGBA, SHALLOW_RGBA, depth);
  const t = (depth - 1) / (DEEP_AT - 1);
  return lerpRgba(SHALLOW_RGBA, DEEP_RGBA, t);
}

/**
 * Translucent water surface plane at `WATER_SURFACE_Y` (6/8 of a terrain step
 * above ground). Covers every DEEP_WATER and SHALLOW_WATER tile plus a
 * one-tile ring of adjacent SAND — the ring hides the shoreline gap that
 * would otherwise show the beach below the waterline where the plane ended
 * at the water-biome boundary mid-tile.
 *
 * Per-tile RGBA vertex colors drive a shore→deep tint: foam white at the
 * beach ring, pale teal one tile in, dark blue in the middle of a lake. An
 * `onBeforeCompile` hook injects a small time-animated sine displacement on
 * Y so the surface shimmers instead of reading as a flat glass pane — the
 * caller ticks `mesh.material.userData.shader.uniforms.uTime` every frame.
 *
 * Returns null when the world contains no water so we don't add an empty
 * mesh to the scene.
 *
 * @param {import('../world/tileGrid.js').TileGrid} tileGrid
 * @returns {THREE.Mesh | null}
 */
export function buildWaterSurface(tileGrid) {
  const { W, H } = tileGrid;
  const halfW = (W * TILE_SIZE) / 2;
  const halfH = (H * TILE_SIZE) / 2;
  const skirted = tileGrid.hasSkirt === true;
  const S = skirted ? SKIRT_TILES : 0;
  const iMin = -S;
  const iMax = W + S;
  const jMin = -S;
  const jMax = H + S;
  const EW = iMax - iMin;
  const EH = jMax - jMin;

  const getBiomeAt = skirted
    ? (i, j) => tileGrid.getSkirtBiome(i, j)
    : (i, j) => tileGrid.getBiome(i, j);

  // Sample biomes into a flat [0..EW)×[0..EH) buffer indexed by (ei, ej) so
  // the BFS below doesn't pay for the getBiomeAt abstraction per lookup.
  const biome = new Uint8Array(EW * EH);
  for (let ej = 0; ej < EH; ej++) {
    for (let ei = 0; ei < EW; ei++) {
      biome[ej * EW + ei] = getBiomeAt(ei + iMin, ej + jMin);
    }
  }
  /** @param {number} ei @param {number} ej */
  const bAt = (ei, ej) => biome[ej * EW + ei];
  /** @param {number} b */
  const isWater = (b) => b === BIOME.SHALLOW_WATER || b === BIOME.DEEP_WATER;

  // BFS of "depth from shore": every non-water tile seeds at depth 0, water
  // tiles inherit min(neighbor depth) + 1. The result directly feeds the
  // foam→shallow→deep color ramp. 8-directional so diagonals count the
  // same way carveDeepWater does.
  const depth = new Int16Array(EW * EH);
  depth.fill(-1);
  /** @type {number[]} */
  const queue = [];
  for (let ej = 0; ej < EH; ej++) {
    for (let ei = 0; ei < EW; ei++) {
      const k = ej * EW + ei;
      if (!isWater(biome[k])) {
        depth[k] = 0;
        queue.push(k);
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    const ei = k % EW;
    const ej = (k - ei) / EW;
    const d = depth[k];
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = ei + di;
        const nj = ej + dj;
        if (ni < 0 || nj < 0 || ni >= EW || nj >= EH) continue;
        const nk = nj * EW + ni;
        if (depth[nk] !== -1) continue;
        if (!isWater(biome[nk])) continue;
        depth[nk] = d + 1;
        queue.push(nk);
      }
    }
  }

  /** @param {number} ei @param {number} ej */
  const isCovered = (ei, ej) => {
    const b = bAt(ei, ej);
    if (isWater(b)) return true;
    if (b !== BIOME.SAND) return false;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = ei + di;
        const nj = ej + dj;
        if (ni < 0 || nj < 0 || ni >= EW || nj >= EH) continue;
        if (isWater(biome[nj * EW + ni])) return true;
      }
    }
    return false;
  };

  let coveredCount = 0;
  for (let ej = 0; ej < EH; ej++) {
    for (let ei = 0; ei < EW; ei++) {
      if (isCovered(ei, ej)) coveredCount++;
    }
  }
  if (coveredCount === 0) return null;

  const positions = new Float32Array(coveredCount * 4 * 3);
  // RGBA color attribute: three.js auto-defines USE_COLOR_ALPHA when the
  // color attribute has itemSize 4, so the built-in MeshStandardMaterial
  // multiplies final alpha by the per-vertex alpha without shader tweaks.
  const colors = new Float32Array(coveredCount * 4 * 4);
  const indices = new Uint32Array(coveredCount * 6);
  let v = 0;
  let c = 0;
  let ix = 0;
  for (let ej = 0; ej < EH; ej++) {
    for (let ei = 0; ei < EW; ei++) {
      if (!isCovered(ei, ej)) continue;
      const i = ei + iMin;
      const j = ej + jMin;
      const x0 = i * TILE_SIZE - halfW;
      const x1 = x0 + TILE_SIZE;
      const z0 = j * TILE_SIZE - halfH;
      const z1 = z0 + TILE_SIZE;
      const baseV = v / 3;
      positions[v++] = x0;
      positions[v++] = WATER_SURFACE_Y;
      positions[v++] = z0;
      positions[v++] = x1;
      positions[v++] = WATER_SURFACE_Y;
      positions[v++] = z0;
      positions[v++] = x1;
      positions[v++] = WATER_SURFACE_Y;
      positions[v++] = z1;
      positions[v++] = x0;
      positions[v++] = WATER_SURFACE_Y;
      positions[v++] = z1;
      const tileDepth = depth[ej * EW + ei];
      const rgba = waterColorForDepth(tileDepth < 0 ? 0 : tileDepth);
      for (let n = 0; n < 4; n++) {
        colors[c++] = rgba[0];
        colors[c++] = rgba[1];
        colors[c++] = rgba[2];
        colors[c++] = rgba[3];
      }
      // CCW from above so the upward normal is +Y (sun-lit).
      indices[ix++] = baseV;
      indices[ix++] = baseV + 2;
      indices[ix++] = baseV + 1;
      indices[ix++] = baseV;
      indices[ix++] = baseV + 3;
      indices[ix++] = baseV + 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    transparent: true,
    vertexColors: true,
    metalness: 0.1,
    roughness: 0.4,
    depthWrite: false,
  });
  // Ripples: inject a tiny time-dependent Y displacement in the vertex
  // shader so the water shimmers without us rewriting the geometry every
  // frame. uTime is ticked by the caller via `material.userData.shader`.
  // Displacement stays well below TERRAIN_STEP/8 so the quarter-wall-in-
  // water silhouette doesn't wobble visibly above/below the surface.
  const ripplesOnBeforeCompile = (
    /** @type {import('three').WebGLProgramParametersWithUniforms} */ shader,
  ) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float ripple = sin(transformed.x * 1.8 + uTime * 2.0) * 0.060
                      + sin(transformed.z * 2.1 - uTime * 1.6) * 0.050
                      + sin((transformed.x + transformed.z) * 1.3 + uTime * 1.1) * 0.035;
         transformed.y += ripple;`,
      );
    material.userData.shader = shader;
  };
  material.onBeforeCompile = ripplesOnBeforeCompile;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
