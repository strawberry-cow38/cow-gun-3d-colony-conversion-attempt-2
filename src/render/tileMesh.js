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

// PS2 dreamcore grass: 7 atlas cells each hold a different LAB-matched
// grass texture. Tiles pick a cell deterministically by coords so the
// field reads as varied turf. The instance color is a slightly-darker
// white so textures come through unmodified but overall brightness is
// knocked down a notch.
const GRASS_DARKEN = 0.9;

// Atlas: 4x4 grid of 512px cells in /textures/grass-atlas.jpg. Tops only —
// cliffs sample their own standalone textures (see CLIFF_COLORS below).
//   0-6   grass variants (grass01-07, LAB-matched)
//   7-8   unused (was purple stone tops — reverted to flat biome-gray via
//         the NON_GRASS_CELL passthrough path)
//   9     pure white — fallback for biomes w/o a baked tile so the per-
//         instance tint passes through unattenuated
//   10-11 dirt tops (grnd03 + grnd04, LAB-matched warm brown)
//   12-14 cliff family (rock01-03)
//   15    sand (grnd01 "Light Sand", LAB-matched to SAND_TOP_COLOR)
// ATLAS_DIVISOR = 1/4 picks one cell out of the 4x4 grid.
const ATLAS_DIVISOR = 1 / 4;
const NON_GRASS_CELL = 9;
const SAND_CELL = 15;
const GRASS_CELLS = [0, 1, 2, 3, 4, 5, 6];
const DIRT_CELLS = [10, 11];

function pickCell(cells, i, j, saltI, saltJ) {
  const h = (i * saltI) ^ (j * saltJ);
  return cells[((h % cells.length) + cells.length) % cells.length];
}
const grassPaletteIndex = (i, j) => pickCell(GRASS_CELLS, i, j, 73856093, 19349663);
const dirtCellIndex = (i, j) => pickCell(DIRT_CELLS, i, j, 83492791, 22695477);

// Cliff faces are grouped by biome family so each family uses its own
// tileable texture (world-space UVs + RepeatWrapping): stone → purple rock
// (rock05); grass/dirt → orange rock (rock02); sand/shallow-water → the
// same Marlin "Light Sand" tile used on the tops so the dune face matches
// the beach it's attached to; deep water → plain vertex-colored quads with
// a biome tint. Textures live outside the grass atlas because they want
// continuous tiling across tile boundaries and their own world-space UV
// period — an atlas cell can't do that without bleeding into neighbors.
const CLIFF_COLORS = {
  [BIOME.DEEP_WATER]: new THREE.Color(0x2a5a8c),
};
const DEFAULT_CLIFF_TINT = new THREE.Color(0x8a6b48);

// One texture repeat per TILE_SIZE world units → short cliffs sample ~half
// the texture vertically, tall cliffs wrap via RepeatWrapping so features
// stay at real-world scale instead of stretching to fill the quad.
const CLIFF_UV_PERIOD = TILE_SIZE;

const CLIFF_FAMILY_ORANGE = 0;
const CLIFF_FAMILY_PURPLE = 1;
const CLIFF_FAMILY_TINTED = 2;
const CLIFF_FAMILY_SAND = 3;

function cliffFamilyForBiome(biome) {
  if (biome === BIOME.STONE) return CLIFF_FAMILY_PURPLE;
  if (biome === BIOME.GRASS || biome === BIOME.DIRT) return CLIFF_FAMILY_ORANGE;
  if (biome === BIOME.SAND || biome === BIOME.SHALLOW_WATER) return CLIFF_FAMILY_SAND;
  return CLIFF_FAMILY_TINTED;
}

/**
 * Resolve the tops atlas cell and per-instance tint for a tile. Writes the
 * tint into `out` in-place so callers can reuse a shared THREE.Color.
 *
 * @param {number} biome
 * @param {number} i @param {number} j
 * @param {number} topShade  elevation brightness factor in [0.75, 1.25]
 * @param {THREE.Color} out
 * @returns {number} atlas cell index
 */
function topCellAndColor(biome, i, j, topShade, out) {
  if (biome === BIOME.GRASS) {
    const g = GRASS_DARKEN * topShade;
    out.setRGB(g, g, g);
    return grassPaletteIndex(i, j);
  }
  if (biome === BIOME.DIRT) {
    out.setRGB(topShade, topShade, topShade);
    return dirtCellIndex(i, j);
  }
  if (biome === BIOME.SAND || biome === BIOME.SHALLOW_WATER) {
    // Boost tint pulls the baked sand tile toward brighter, warmer, more-
    // saturated tan. Channels > 1 overdrive the tops shader's vertex-color
    // multiply (MeshStandardMaterial accepts HDR instance colors).
    out.setRGB(topShade * 1.22, topShade * 1.12, topShade * 0.94);
    return SAND_CELL;
  }
  const base = BIOME_COLORS[biome] || BIOME_COLORS[BIOME.GRASS];
  out.setRGB(base.r * topShade, base.g * topShade, base.b * topShade);
  return NON_GRASS_CELL;
}

/**
 * Pre-sized typed-array bucket for one cliff biome family. Worst case is
 * every tile in the chunk emitting 4 cliff quads to this family; the typed
 * arrays are sliced to actual length at mesh construction.
 *
 * @param {number} tileCount
 */
function makeCliffBucket(tileCount) {
  return {
    pos: new Float32Array(tileCount * 4 * 4 * 3),
    col: new Float32Array(tileCount * 4 * 4 * 3),
    uv: new Float32Array(tileCount * 4 * 4 * 2),
    idx: new Uint32Array(tileCount * 4 * 6),
    vCount: 0,
    iCount: 0,
  };
}

/**
 * Resolve per-vertex RGB for a cliff. Orange/purple families use plain
 * white (the texture supplies the color); tinted family pulls from
 * CLIFF_COLORS so beach/water cliffs still read as their biome.
 *
 * @param {number} family
 * @param {number} biome
 * @param {{ r: number, g: number, b: number }} out
 */
function cliffColor(family, biome, out) {
  if (family === CLIFF_FAMILY_TINTED) {
    const tint = CLIFF_COLORS[biome] || DEFAULT_CLIFF_TINT;
    out.r = tint.r;
    out.g = tint.g;
    out.b = tint.b;
  } else if (family === CLIFF_FAMILY_SAND) {
    // HDR overdrive on the sand cliff texture so the dune face matches the
    // punchier top tint and reads warmer than the raw image.
    out.r = 1.22;
    out.g = 1.12;
    out.b = 0.94;
  } else {
    out.r = 1;
    out.g = 1;
    out.b = 1;
  }
}

// Cell index → atlas UV offset (tops only — cliffs use world-space UVs).
function cellColUV(cellIdx) {
  return (cellIdx % 4) * ATLAS_DIVISOR;
}
function cellRowUV(cellIdx) {
  return Math.floor(cellIdx / 4) * ATLAS_DIVISOR;
}

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

// Cliff textures live as standalone 512x512 images (not in the atlas) so we
// can use RepeatWrapping — atlas cells would bleed into neighbors if UV
// exceeded the cell box. World-space UVs combined with wrapping give
// seamless texture across tile boundaries.
function makeCliffTexture(path) {
  const tex = new THREE.TextureLoader().load(path);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
let _cliffOrangeTex = null;
let _cliffPurpleTex = null;
let _cliffSandTex = null;
function getCliffOrangeTexture() {
  if (!_cliffOrangeTex) _cliffOrangeTex = makeCliffTexture('textures/cliff-orange.jpg');
  return _cliffOrangeTex;
}
function getCliffPurpleTexture() {
  if (!_cliffPurpleTex) _cliffPurpleTex = makeCliffTexture('textures/cliff-purple.jpg');
  return _cliffPurpleTex;
}
function getCliffSandTexture() {
  if (!_cliffSandTex) _cliffSandTex = makeCliffTexture('textures/cliff-sand.jpg');
  return _cliffSandTex;
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
const _cliffRGB = { r: 0, g: 0, b: 0 };

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

  // Shared materials across chunks: tops sample the grass atlas via a
  // per-instance UV offset. Cliffs split by biome family: orange (grass /
  // dirt / any exposed subsoil) and purple (stone) each sample their own
  // standalone tileable rock texture with world-space UVs + RepeatWrapping,
  // so long vertical faces and multi-tile ledges show one continuous rock
  // surface instead of per-tile seams. The tinted family has no map —
  // vertex colors carry the sand / water biome tint directly.
  const topsMaterial = makeTopsMaterial();
  const cliffMaterials = [
    new THREE.MeshStandardMaterial({
      map: getCliffOrangeTexture(),
      vertexColors: true,
      flatShading: true,
      metalness: 0,
      roughness: 1,
    }),
    new THREE.MeshStandardMaterial({
      map: getCliffPurpleTexture(),
      vertexColors: true,
      flatShading: true,
      metalness: 0,
      roughness: 1,
    }),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      metalness: 0,
      roughness: 1,
    }),
    new THREE.MeshStandardMaterial({
      map: getCliffSandTexture(),
      vertexColors: true,
      flatShading: true,
      metalness: 0,
      roughness: 1,
    }),
  ];

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
        cliffMaterials,
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
 * Locate the chunk containing tile (i, j). Returns the chunk Group plus its
 * instance index within the tops InstancedMesh, or null if the tile falls
 * outside the terrain group's coverage.
 *
 * Instance layout in each chunk matches the build-time loop: outer j, inner
 * i, so `k = (j - j0) * width + (i - i0)`.
 *
 * @param {THREE.Group} group  terrain group returned by buildTileMesh
 * @param {number} i
 * @param {number} j
 * @returns {{ chunk: THREE.Group, instanceId: number } | null}
 */
export function findTileInstance(group, i, j) {
  for (const obj of group.children) {
    const chunk = /** @type {THREE.Group} */ (obj);
    const ud =
      /** @type {{ i0: number, j0: number, width: number, height: number } | undefined} */ (
        chunk.userData
      );
    if (!ud) continue;
    const di = i - ud.i0;
    const dj = j - ud.j0;
    if (di < 0 || dj < 0 || di >= ud.width || dj >= ud.height) continue;
    return { chunk, instanceId: dj * ud.width + di };
  }
  return null;
}

/**
 * Inverse of findTileInstance: given a chunk and an instance id, return the
 * world-tile coordinates that instance represents.
 *
 * @param {THREE.Group} chunk
 * @param {number} instanceId
 * @returns {{ i: number, j: number } | null}
 */
export function chunkInstanceToTile(chunk, instanceId) {
  const ud = /** @type {{ i0: number, j0: number, width: number, height: number } | undefined} */ (
    chunk.userData
  );
  if (!ud) return null;
  if (instanceId < 0 || instanceId >= ud.width * ud.height) return null;
  const dj = Math.floor(instanceId / ud.width);
  const di = instanceId - dj * ud.width;
  return { i: ud.i0 + di, j: ud.j0 + dj };
}

/**
 * Repaint tile (i, j) in-place: updates the instance tint and atlas UV offset
 * to match the new biome. Cheap — no geometry rebuild, no allocation. Does
 * NOT touch cliffs; a biome change in isolation keeps existing cliff
 * colouring until the next full-group rebuild (cliffs rarely read by a
 * casual player and repainting them would require rebuilding the chunk's
 * cliff BufferGeometry).
 *
 * Returns true on success, false if the tile is not in the terrain group.
 *
 * @param {THREE.Group} group  terrain group returned by buildTileMesh
 * @param {number} i
 * @param {number} j
 * @param {number} biome  BIOME.* enum value
 * @param {number} y  current elevation (used for the brightness shade)
 * @returns {boolean}
 */
export function setTileBiome(group, i, j, biome, y) {
  const hit = findTileInstance(group, i, j);
  if (!hit) return false;
  const topsMesh = /** @type {THREE.InstancedMesh} */ (hit.chunk.children[0]);
  const topShade = 1 + Math.max(-0.25, Math.min(0.25, y / 60));
  const cellIdx = topCellAndColor(biome, i, j, topShade, _color);
  topsMesh.setColorAt(hit.instanceId, _color);
  if (topsMesh.instanceColor) topsMesh.instanceColor.needsUpdate = true;

  const uvAttr = /** @type {THREE.InstancedBufferAttribute} */ (
    topsMesh.geometry.getAttribute('instanceUvOffset')
  );
  const arr = /** @type {Float32Array} */ (uvAttr.array);
  arr[hit.instanceId * 2] = cellColUV(cellIdx);
  arr[hit.instanceId * 2 + 1] = cellRowUV(cellIdx);
  uvAttr.needsUpdate = true;
  return true;
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
  cliffMaterials,
}) {
  const width = i1 - i0;
  const height = j1 - j0;
  const tileCount = width * height;
  if (tileCount === 0) return null;

  // Cliffs split into 4 family buckets (orange / purple / tinted / sand).
  // Each bucket is its own typed-array trio (pos / color / uv / index) and
  // becomes a dedicated sub-mesh with its own material + texture. Worst
  // case is 4 quads × tile in a single family, so per-bucket allocations
  // are oversized to the chunk max and sliced at emit.
  const buckets = [
    makeCliffBucket(tileCount),
    makeCliffBucket(tileCount),
    makeCliffBucket(tileCount),
    makeCliffBucket(tileCount),
  ];

  const pushCliff = (ax, az, bx, bz, topY, bottomY, r, g, b, family) => {
    const bucket = buckets[family];
    const baseV = bucket.vCount;
    const p = bucket.pos;
    let pv = baseV * 3;
    p[pv++] = ax;
    p[pv++] = topY;
    p[pv++] = az;
    p[pv++] = bx;
    p[pv++] = topY;
    p[pv++] = bz;
    p[pv++] = bx;
    p[pv++] = bottomY;
    p[pv++] = bz;
    p[pv++] = ax;
    p[pv++] = bottomY;
    p[pv++] = az;
    const c = bucket.col;
    let cOff = baseV * 3;
    for (let k = 0; k < 4; k++) {
      c[cOff++] = r;
      c[cOff++] = g;
      c[cOff++] = b;
    }
    // World-space UVs so adjacent tile cliffs share one continuous texture
    // (no per-tile seam) and vertical features stay at real-world scale
    // instead of stretching to fill each quad. Horizontal UV tracks the
    // varying world axis along the top edge (X for N/S-facing quads, Z for
    // E/W-facing); vertical UV tracks worldY with flipY=true semantics
    // (higher Y → higher v → texture top).
    const uvs = bucket.uv;
    let uOff = baseV * 2;
    const alongAxisA = ax !== bx ? ax : az;
    const alongAxisB = ax !== bx ? bx : bz;
    const uA = alongAxisA / CLIFF_UV_PERIOD;
    const uB = alongAxisB / CLIFF_UV_PERIOD;
    const vTop = topY / CLIFF_UV_PERIOD;
    const vBot = bottomY / CLIFF_UV_PERIOD;
    uvs[uOff++] = uA;
    uvs[uOff++] = vTop;
    uvs[uOff++] = uB;
    uvs[uOff++] = vTop;
    uvs[uOff++] = uB;
    uvs[uOff++] = vBot;
    uvs[uOff++] = uA;
    uvs[uOff++] = vBot;
    const idx = bucket.idx;
    let iOff = bucket.iCount;
    idx[iOff++] = baseV;
    idx[iOff++] = baseV + 1;
    idx[iOff++] = baseV + 2;
    idx[iOff++] = baseV;
    idx[iOff++] = baseV + 2;
    idx[iOff++] = baseV + 3;
    bucket.vCount = baseV + 4;
    bucket.iCount = iOff;
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
      const cellIdx = topCellAndColor(biome, i, j, topShade, _color);
      topsMesh.setColorAt(k, _color);
      uvOffsets[k * 2] = cellColUV(cellIdx);
      uvOffsets[k * 2 + 1] = cellRowUV(cellIdx);

      // Out-of-bounds neighbors drop to Y=0 (the water plane). Same-or-higher
      // neighbors get skipped — their own face will cover it when rendered.
      // Defer family + color lookup until we know at least one edge drops,
      // so flat terrain skips the work entirely.
      const yW = i > iMin ? getElev(i - 1, j) : 0;
      const yE = i < iMax - 1 ? getElev(i + 1, j) : 0;
      const yN = j > jMin ? getElev(i, j - 1) : 0;
      const yS = j < jMax - 1 ? getElev(i, j + 1) : 0;
      if (yW < y || yE < y || yN < y || yS < y) {
        const family = cliffFamilyForBiome(biome);
        cliffColor(family, biome, _cliffRGB);
        const cr = _cliffRGB.r;
        const cg = _cliffRGB.g;
        const cb = _cliffRGB.b;
        if (yW < y) pushCliff(x0, z1, x0, z0, y, yW, cr, cg, cb, family);
        if (yE < y) pushCliff(x1, z0, x1, z1, y, yE, cr, cg, cb, family);
        if (yN < y) pushCliff(x0, z0, x1, z0, y, yN, cr, cg, cb, family);
        if (yS < y) pushCliff(x1, z1, x0, z1, y, yS, cr, cg, cb, family);
      }

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

  const cliffNames = ['cliffs-orange', 'cliffs-purple', 'cliffs-tinted', 'cliffs-sand'];
  for (let f = 0; f < buckets.length; f++) {
    const bucket = buckets[f];
    if (bucket.vCount === 0) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      'position',
      new THREE.BufferAttribute(bucket.pos.subarray(0, bucket.vCount * 3), 3),
    );
    geom.setAttribute(
      'color',
      new THREE.BufferAttribute(bucket.col.subarray(0, bucket.vCount * 3), 3),
    );
    geom.setAttribute('uv', new THREE.BufferAttribute(bucket.uv.subarray(0, bucket.vCount * 2), 2));
    geom.setIndex(new THREE.BufferAttribute(bucket.idx.subarray(0, bucket.iCount), 1));
    geom.computeVertexNormals();
    geom.computeBoundingSphere();
    const mesh = new THREE.Mesh(geom, cliffMaterials[f]);
    mesh.name = cliffNames[f];
    mesh.receiveShadow = true;
    chunk.add(mesh);
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
