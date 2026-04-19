import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { chunkInstanceToTile, findTileInstance, setTileBiome } from '../../src/render/tileMesh.js';
import { BIOME } from '../../src/world/tileGrid.js';

/**
 * Build a chunk Group that matches the shape buildChunkMesh produces: a
 * tops InstancedMesh at children[0] with an instanceUvOffset buffer and a
 * primed instanceColor, plus the userData the mutators key off. Avoids
 * calling buildTileMesh directly — that path hits THREE.TextureLoader which
 * needs a browser's Image API.
 *
 * @param {number} i0 @param {number} j0 @param {number} width @param {number} height
 */
function makeMockChunk(i0, j0, width, height) {
  const chunk = new THREE.Group();
  chunk.userData = { i0, j0, width, height };
  const count = width * height;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.setAttribute(
    'instanceUvOffset',
    new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2),
  );
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), count);
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  chunk.add(mesh);
  return chunk;
}

describe('findTileInstance', () => {
  it('maps (i,j) to the build-time instance index (dj*width + di)', () => {
    const group = new THREE.Group();
    group.add(makeMockChunk(0, 0, 4, 4));
    expect(findTileInstance(group, 0, 0)).toEqual({
      chunk: group.children[0],
      instanceId: 0,
    });
    // i=3, j=2 → di=3, dj=2, width=4 → 2*4+3 = 11
    expect(findTileInstance(group, 3, 2)).toEqual({
      chunk: group.children[0],
      instanceId: 11,
    });
  });

  it('returns null when the tile is outside the group', () => {
    const group = new THREE.Group();
    group.add(makeMockChunk(0, 0, 4, 4));
    expect(findTileInstance(group, -1, 0)).toBeNull();
    expect(findTileInstance(group, 4, 0)).toBeNull();
    expect(findTileInstance(group, 0, 99)).toBeNull();
  });

  it('picks the chunk that owns the tile across a multi-chunk group', () => {
    const group = new THREE.Group();
    group.add(makeMockChunk(0, 0, 2, 2));
    group.add(makeMockChunk(2, 0, 2, 2));
    group.add(makeMockChunk(0, 2, 2, 2));
    const hit = findTileInstance(group, 3, 1);
    expect(hit?.chunk).toBe(group.children[1]);
    // di=1, dj=1, width=2 → 1*2+1 = 3
    expect(hit?.instanceId).toBe(3);
  });
});

describe('chunkInstanceToTile', () => {
  it('inverts findTileInstance across the full index range', () => {
    const chunk = makeMockChunk(5, 10, 4, 3);
    expect(chunkInstanceToTile(chunk, 0)).toEqual({ i: 5, j: 10 });
    // 7 = 1*4 + 3 → di=3, dj=1 → i=8, j=11
    expect(chunkInstanceToTile(chunk, 7)).toEqual({ i: 8, j: 11 });
    expect(chunkInstanceToTile(chunk, 11)).toEqual({ i: 8, j: 12 });
  });

  it('round-trips for every tile in a chunk', () => {
    const chunk = makeMockChunk(3, 7, 5, 4);
    const group = new THREE.Group();
    group.add(chunk);
    for (let k = 0; k < 20; k++) {
      const tile = chunkInstanceToTile(chunk, k);
      if (!tile) throw new Error(`expected tile for instance ${k}`);
      const hit = findTileInstance(group, tile.i, tile.j);
      expect(hit?.instanceId).toBe(k);
    }
  });

  it('returns null for ids outside [0, width*height)', () => {
    const chunk = makeMockChunk(0, 0, 2, 2);
    expect(chunkInstanceToTile(chunk, -1)).toBeNull();
    expect(chunkInstanceToTile(chunk, 4)).toBeNull();
  });
});

describe('setTileBiome', () => {
  it('writes UV offset to the non-grass atlas cell (9) for sand biome', () => {
    const group = new THREE.Group();
    group.add(makeMockChunk(0, 0, 4, 4));
    expect(setTileBiome(group, 2, 1, BIOME.SAND, 0)).toBe(true);
    const mesh = /** @type {THREE.InstancedMesh} */ (group.children[0].children[0]);
    const uvAttr = /** @type {THREE.InstancedBufferAttribute} */ (
      mesh.geometry.getAttribute('instanceUvOffset')
    );
    const k = 1 * 4 + 2; // dj=1, di=2
    // Cell 9 = col 1, row 2 in a 4×4 atlas (ATLAS_DIVISOR = 0.25).
    expect(uvAttr.array[k * 2]).toBeCloseTo(0.25, 6);
    expect(uvAttr.array[k * 2 + 1]).toBeCloseTo(0.5, 6);
    // needsUpdate is a write-only setter on BufferAttribute that bumps
    // `version`; we verify the bump rather than the boolean.
    expect(uvAttr.version).toBeGreaterThan(0);
  });

  it('writes a grass-cell UV offset (cells 0-6) for grass biome', () => {
    const group = new THREE.Group();
    group.add(makeMockChunk(0, 0, 4, 4));
    expect(setTileBiome(group, 0, 0, BIOME.GRASS, 0)).toBe(true);
    const mesh = /** @type {THREE.InstancedMesh} */ (group.children[0].children[0]);
    const uvAttr = mesh.geometry.getAttribute('instanceUvOffset');
    // Grass cells 0-6 live in rows 0-1 (cell/4 < 2), so V offset < 0.5.
    expect(uvAttr.array[1]).toBeLessThan(0.5);
  });

  it('routes stone biome tops to one of the stone atlas cells (7 or 8)', () => {
    const group = new THREE.Group();
    group.add(makeMockChunk(0, 0, 4, 4));
    expect(setTileBiome(group, 2, 1, BIOME.STONE, 0)).toBe(true);
    const mesh = /** @type {THREE.InstancedMesh} */ (group.children[0].children[0]);
    const uvAttr = mesh.geometry.getAttribute('instanceUvOffset');
    const k = 1 * 4 + 2;
    const u = uvAttr.array[k * 2];
    const v = uvAttr.array[k * 2 + 1];
    // Cell 7 = (col 3, row 1) = (0.75, 0.25). Cell 8 = (col 0, row 2) = (0, 0.5).
    const isCell7 = Math.abs(u - 0.75) < 1e-6 && Math.abs(v - 0.25) < 1e-6;
    const isCell8 = Math.abs(u - 0.0) < 1e-6 && Math.abs(v - 0.5) < 1e-6;
    expect(isCell7 || isCell8).toBe(true);
  });

  it('bumps instanceColor version so the GPU resyncs on next draw', () => {
    const group = new THREE.Group();
    group.add(makeMockChunk(0, 0, 4, 4));
    const mesh = /** @type {THREE.InstancedMesh} */ (group.children[0].children[0]);
    const color = /** @type {THREE.InstancedBufferAttribute} */ (mesh.instanceColor);
    const before = color.version;
    setTileBiome(group, 0, 0, BIOME.DIRT, 0);
    expect(color.version).toBeGreaterThan(before);
  });

  it('returns false without mutating when the tile is outside the group', () => {
    const group = new THREE.Group();
    group.add(makeMockChunk(0, 0, 2, 2));
    expect(setTileBiome(group, 99, 99, BIOME.GRASS, 0)).toBe(false);
  });
});
