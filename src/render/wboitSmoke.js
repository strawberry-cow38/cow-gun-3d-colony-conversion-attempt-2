/**
 * Dev-only smoke test: spawn 10 overlapping semi-transparent cubes using
 * MeshWboitMaterial to verify the OIT pipeline renders correctly from any
 * camera angle.
 *
 * Opted in via `?oitTest` URL param. Safe to remove once visual confirmation
 * of OIT in-game is sufficient.
 */

import { BoxGeometry, Color, Mesh } from 'three';
import { MeshWboitMaterial } from './wboit/materials/MeshWboitMaterial.js';

/**
 * @param {import('three').Scene} scene
 * @param {{ x?: number, y?: number, z?: number, spread?: number, count?: number }} [opts]
 */
export function spawnOitSmokeTest(scene, opts = {}) {
  const cx = opts.x ?? 0;
  const cy = opts.y ?? 10;
  const cz = opts.z ?? 0;
  const spread = opts.spread ?? 3;
  const count = opts.count ?? 10;

  const geo = new BoxGeometry(4, 4, 4);

  for (let i = 0; i < count; i++) {
    const mat = new MeshWboitMaterial({
      color: new Color().setHSL(i / count, 0.85, 0.55),
      opacity: 0.45,
    });
    const mesh = new Mesh(geo, mat);
    const t = (i / count) * Math.PI * 2;
    mesh.position.set(
      cx + Math.cos(t) * spread,
      cy + ((i % 3) - 1) * 1.5,
      cz + Math.sin(t) * spread,
    );
    mesh.name = `oit_smoke_${i}`;
    scene.add(mesh);
  }

  console.log(
    `[wboit smoke] spawned ${count} overlapping MeshWboitMaterial cubes at (${cx},${cy},${cz})`,
  );
}
