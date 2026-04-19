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
  [BIOME.GRASS]: new THREE.Color(0x6db416),
  [BIOME.DIRT]: new THREE.Color(0x6b4f2a),
  [BIOME.STONE]: new THREE.Color(0x6a6e74),
  [BIOME.SAND]: SAND_TOP_COLOR,
  [BIOME.SHALLOW_WATER]: SAND_TOP_COLOR,
  [BIOME.DEEP_WATER]: new THREE.Color(0x2a5a8c),
};

// PS2 dreamcore grass palette: 9 mean colors sampled from Marlin Studios
// "Seamless Textures vol 1" grass tiles after LAB color-matching to a
// unified bright green and HSV saturation boost. Each grass tile picks one
// palette entry deterministically by tile coords so the field reads as
// varied turf instead of a single flat green slab.
const GRASS_PALETTE = [
  new THREE.Color(0x80bf37),
  new THREE.Color(0x7ab62e),
  new THREE.Color(0x79ba26),
  new THREE.Color(0x6db821),
  new THREE.Color(0x67af1e),
  new THREE.Color(0x64aa23),
  new THREE.Color(0x61a72b),
  new THREE.Color(0x63aa2a),
  new THREE.Color(0x5fa52f),
];

function grassPaletteIndex(i, j) {
  // Cheap integer hash so neighboring tiles rarely land on the same shade.
  const h = (i * 73856093) ^ (j * 19349663);
  return ((h % GRASS_PALETTE.length) + GRASS_PALETTE.length) % GRASS_PALETTE.length;
}

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

// Atlas: 4x4 grid of 512px cells in /textures/grass-atlas.jpg. Cells 0-8 are
// PS2-tinted Marlin Studios grass; cell 9 is pure white so non-grass biomes
// can UV-offset there and let their per-instance color tint pass through
// unattenuated. ATLAS_DIVISOR = 1/4 picks one cell out of the 4x4 grid.
const ATLAS_DIVISOR = 1 / 4;
const NON_GRASS_CELL = 9;

let _grassAtlas = null;
function getGrassAtlas() {
  if (_grassAtlas) return _grassAtlas;
  _grassAtlas = new THREE.TextureLoader().load('textures/grass-atlas.jpg');
  // flipY=false so UV (0,0) maps to the top-left of the image — matches the
  // baker script's `paste(tile, (col*512, row*512))` row-major coordinates.
  _grassAtlas.flipY = false;
  // PS2 dreamcore look: nearest-neighbour sampling at close range, mip chain
  // for distance smoothing so far tiles don't shimmer.
  _grassAtlas.magFilter = THREE.NearestFilter;
  _grassAtlas.minFilter = THREE.NearestMipmapLinearFilter;
  _grassAtlas.anisotropy = 4;
  _grassAtlas.colorSpace = THREE.SRGBColorSpace;
  return _grassAtlas;
}

// Shared horizontal quad geometry (TILE_SIZE square, +Y normal, UV [0,1] per
// vertex). Each chunk clones this so it can attach its own per-instance
// `instanceUvOffset` buffer (the divisor-shifted atlas cell offset is
// per-instance, but the base UVs and verts are identical across chunks).
let _topBaseGeom = null;
function getTopBaseGeometry() {
  if (_topBaseGeom) return _topBaseGeom;
  _topBaseGeom = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
  _topBaseGeom.rotateX(-Math.PI / 2);
  return _topBaseGeom;
}

function makeTopsMaterial() {
  // No `vertexColors: true` — the base plane has no color attribute. Per-tile
  // color comes from InstancedMesh.setColorAt; three auto-defines
  // USE_INSTANCING_COLOR so the instance tint multiplies into diffuseColor
  // downstream of the atlas sample.
  const mat = new THREE.MeshStandardMaterial({
    map: getGrassAtlas(),
    flatShading: true,
    metalness: 0,
    roughness: 1,
  });
  // Patch the vertex shader so each instance samples its own atlas cell:
  // the base plane has UV in [0,1]; we shrink by ATLAS_DIVISOR so the UV
  // walks one cell, then add the per-instance offset to slide into the
  // chosen cell. `instanceUvOffset` is supplied by every chunk geometry.
  // Three's <uv_vertex> chunk computes all map UVs in one block; replace the
  // MAP_UV line inside that chunk while leaving the rest intact.
  const patchedUvVertex = THREE.ShaderChunk.uv_vertex.replace(
    'vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;',
    `vMapUv = ( mapTransform * vec3( MAP_UV * ${ATLAS_DIVISOR.toFixed(6)} + instanceUvOffset, 1 ) ).xy;`,
  );
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 instanceUvOffset;')
      .replace('#include <uv_vertex>', patchedUvVertex);
  };
  return mat;
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();

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

  // Two shared materials across chunks: tops sample the atlas + multiply by
  // per-instance color (carries biome tint × elevation shading); cliffs stay
  // vertex-coloured (cliff faces are short-lived, not worth atlas-ing).
  const topsMaterial = makeTopsMaterial();
  const cliffsMaterial = new THREE.MeshStandardMaterial({
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
      const mesh = buildChunkMesh({
        i0: ci0,
        i1: ci1,
        j0: cj0,
        j1: cj1,
        iMin,
        iMax,
        jMin,
        jMax,
        halfW,
        halfH,
        getElev,
        getBiome,
        topsMaterial,
        cliffsMaterial,
      });
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
 * Each chunk is itself a Group containing two child Meshes (tops + cliffs);
 * walk both levels.
 *
 * @param {THREE.Group} group
 */
export function disposeTileMesh(group) {
  /** @type {Set<THREE.Material>} */
  const materials = new Set();
  for (const chunk of group.children) {
    for (const child of chunk.children) {
      const mesh = /** @type {THREE.Mesh} */ (child);
      mesh.geometry.dispose();
      materials.add(/** @type {THREE.Material} */ (mesh.material));
    }
  }
  for (const mat of materials) mat.dispose();
}

/**
 * Build one chunk over the sub-rect [i0, i1) × [j0, j1) as a Group of two
 * child Meshes:
 *   - `tops`: an InstancedMesh (one instance per tile) sampling the grass
 *     atlas via a per-instance UV offset attribute and tinted by
 *     per-instance color (elevation shading for grass, biome color ×
 *     shading for non-grass where the atlas cell is white).
 *   - `cliffs`: per-edge vertical quads as a vertex-colored BufferGeometry
 *     where a neighbor tile sits lower.
 *
 * Cliff edge checks use the global `iMin/iMax/jMin/jMax` so cliffs at the
 * outer map border drop to Y=0 (not to the neighboring chunk's in-bounds
 * tile).
 *
 * `chunk.userData = { i0, j0, width, height }` lets the per-tile mutator
 * API resolve a tile (i,j) to its instance index within the chunk.
 *
 * @returns {THREE.Group | null}
 */
function buildChunkMesh({
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
  topsMaterial,
  cliffsMaterial,
}) {
  const width = i1 - i0;
  const height = j1 - j0;
  const tileCount = width * height;
  if (tileCount === 0) return null;

  // Cliffs: worst case 4 quads × tile.
  const cliffsPos = new Float32Array(tileCount * 4 * 4 * 3);
  const cliffsCol = new Float32Array(tileCount * 4 * 4 * 3);
  const cliffsIdx = new Uint32Array(tileCount * 4 * 6);
  let cv = 0;
  let cix = 0;

  const pushCliff = (ax, az, bx, bz, topY, bottomY, r, g, b) => {
    const baseV = cv / 3;
    cliffsPos[cv++] = ax;
    cliffsPos[cv++] = topY;
    cliffsPos[cv++] = az;
    cliffsPos[cv++] = bx;
    cliffsPos[cv++] = topY;
    cliffsPos[cv++] = bz;
    cliffsPos[cv++] = bx;
    cliffsPos[cv++] = bottomY;
    cliffsPos[cv++] = bz;
    cliffsPos[cv++] = ax;
    cliffsPos[cv++] = bottomY;
    cliffsPos[cv++] = az;
    for (let k = 0; k < 4; k++) {
      const o = (baseV + k) * 3;
      cliffsCol[o] = r;
      cliffsCol[o + 1] = g;
      cliffsCol[o + 2] = b;
    }
    cliffsIdx[cix++] = baseV;
    cliffsIdx[cix++] = baseV + 1;
    cliffsIdx[cix++] = baseV + 2;
    cliffsIdx[cix++] = baseV;
    cliffsIdx[cix++] = baseV + 2;
    cliffsIdx[cix++] = baseV + 3;
  };

  // Tops: one InstancedMesh per chunk. Geometry is a cloned unit quad so
  // we can attach a per-chunk instanceUvOffset buffer.
  const topsGeom = getTopBaseGeometry().clone();
  const uvOffsets = new Float32Array(tileCount * 2);
  const topsMesh = new THREE.InstancedMesh(topsGeom, topsMaterial, tileCount);
  topsMesh.name = 'tops';
  topsMesh.receiveShadow = true;
  // Force three to allocate the instanceColor attribute before the loop
  // (setColorAt lazily creates it on first call); the placeholder value
  // gets overwritten by the per-tile setColorAt below.
  topsMesh.setColorAt(0, _color.setRGB(1, 1, 1));
  _quat.identity();

  let k = 0;
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const x0 = i * TILE_SIZE - halfW;
      const x1 = x0 + TILE_SIZE;
      const z0 = j * TILE_SIZE - halfH;
      const z1 = z0 + TILE_SIZE;
      const y = getElev(i, j);

      _position.set(x0 + TILE_SIZE / 2, y, z0 + TILE_SIZE / 2);
      _matrix.compose(_position, _quat, _scale);
      topsMesh.setMatrixAt(k, _matrix);

      const biome = getBiome(i, j);
      const topShade = 1 + Math.max(-0.25, Math.min(0.25, y / 60));
      let cellIdx;
      if (biome === BIOME.GRASS) {
        // Grass: atlas cell supplies the color; instance tint is just the
        // elevation shade (white * topShade).
        cellIdx = grassPaletteIndex(i, j);
        _color.setRGB(topShade, topShade, topShade);
      } else {
        // Non-grass biomes sample cell 9 (pure white) so the biome tint
        // passes through the texture sample unattenuated.
        cellIdx = NON_GRASS_CELL;
        const base = BIOME_COLORS[biome] || BIOME_COLORS[BIOME.GRASS];
        _color.setRGB(base.r * topShade, base.g * topShade, base.b * topShade);
      }
      topsMesh.setColorAt(k, _color);
      uvOffsets[k * 2] = (cellIdx % 4) * ATLAS_DIVISOR;
      uvOffsets[k * 2 + 1] = Math.floor(cellIdx / 4) * ATLAS_DIVISOR;

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

      k++;
    }
  }

  topsGeom.setAttribute('instanceUvOffset', new THREE.InstancedBufferAttribute(uvOffsets, 2));
  topsMesh.count = tileCount;
  topsMesh.instanceMatrix.needsUpdate = true;
  if (topsMesh.instanceColor) topsMesh.instanceColor.needsUpdate = true;
  topsMesh.computeBoundingSphere();

  const chunk = new THREE.Group();
  chunk.name = 'terrain-chunk';
  chunk.userData = { i0, j0, width, height };
  chunk.add(topsMesh);

  if (cv > 0) {
    const cliffsGeom = new THREE.BufferGeometry();
    cliffsGeom.setAttribute('position', new THREE.BufferAttribute(cliffsPos.subarray(0, cv), 3));
    cliffsGeom.setAttribute('color', new THREE.BufferAttribute(cliffsCol.subarray(0, cv), 3));
    cliffsGeom.setIndex(new THREE.BufferAttribute(cliffsIdx.subarray(0, cix), 1));
    cliffsGeom.computeVertexNormals();
    cliffsGeom.computeBoundingSphere();
    const cliffsMesh = new THREE.Mesh(cliffsGeom, cliffsMaterial);
    cliffsMesh.name = 'cliffs';
    cliffsMesh.receiveShadow = true;
    chunk.add(cliffsMesh);
  }

  return chunk;
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
    // Avoid the specular "swimming pool" sun-glare on the water surface.
    metalness: 0,
    roughness: 1,
    depthWrite: false,
  });
  // Ripples: inject a time-dependent Y displacement in the vertex shader so
  // the water shimmers without us rewriting the geometry every frame. uTime
  // is ticked by the caller via `material.userData.shader`. Normals are
  // recomputed analytically from the sine derivative so the ripple picks
  // up light/shadow variance — without this the surface reads as flat
  // because MeshStandardMaterial would shade every vertex by the static
  // +Y normal regardless of vertex displacement.
  const ripplesOnBeforeCompile = (
    /** @type {import('three').WebGLProgramParametersWithUniforms} */ shader,
  ) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         float rippleY(vec2 p) {
           return sin(p.x * 1.8 + uTime * 2.0) * 0.120
                + sin(p.y * 2.1 - uTime * 1.6) * 0.100
                + sin((p.x + p.y) * 1.3 + uTime * 1.1) * 0.070;
         }
         vec3 rippleNormal(vec2 p) {
           float dx = cos(p.x * 1.8 + uTime * 2.0) * 1.8 * 0.120
                    + cos((p.x + p.y) * 1.3 + uTime * 1.1) * 1.3 * 0.070;
           float dz = -cos(p.y * 2.1 - uTime * 1.6) * 2.1 * 0.100
                    + cos((p.x + p.y) * 1.3 + uTime * 1.1) * 1.3 * 0.070;
           return normalize(vec3(-dx, 1.0, -dz));
         }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = rippleNormal(position.xz);
         #ifdef USE_TANGENT
         vec3 objectTangent = vec3(tangent.xyz);
         #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.y += rippleY(transformed.xz);`,
      );
    material.userData.shader = shader;
  };
  material.onBeforeCompile = ripplesOnBeforeCompile;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
