/**
 * Phase 1 entry: ECS + 30Hz sim loop + stress test of 1000 entities.
 *
 * Wires:
 *   - World (ECS)
 *   - Scheduler (tier-based system runner)
 *   - SimLoop (fixed-step 30Hz with render alpha)
 *   - StressInstancer (renders all StressViz entities as InstancedMesh cubes)
 *   - HUD overlay (sim Hz, render FPS, per-system ms)
 */

import { registerPhase1Components } from './components/index.js';
import { Scheduler } from './ecs/schedule.js';
import { World } from './ecs/world.js';
import { createScene } from './render/scene.js';
import { createStressInstancer } from './render/stressInstancer.js';
import { SimLoop } from './sim/loop.js';
import { applyVelocity, snapshotPositions, spawnStressEntities, stressBounce } from './stress.js';

const STRESS_COUNT = 1000;

const world = new World();
registerPhase1Components(world);

const scheduler = new Scheduler();
scheduler.add(snapshotPositions);
scheduler.add(applyVelocity);
scheduler.add(stressBounce);

spawnStressEntities(world, STRESS_COUNT);

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
const { renderer, scene, camera } = createScene(canvas);
const stressInstancer = createStressInstancer(scene, STRESS_COUNT);

const hud = /** @type {HTMLElement} */ (document.getElementById('hud'));
let renderFrameCount = 0;
let renderFpsSampleStart = performance.now();
let measuredFps = 0;

const loop = new SimLoop({
  step(dt, tick) {
    scheduler.tick(world, tick, dt);
  },
  render(alpha) {
    stressInstancer.update(world, alpha);
    renderer.render(scene, camera);
    renderFrameCount++;
    const now = performance.now();
    if (now - renderFpsSampleStart >= 500) {
      measuredFps = (renderFrameCount * 1000) / (now - renderFpsSampleStart);
      renderFrameCount = 0;
      renderFpsSampleStart = now;
      updateHud();
    }
  },
});

function updateHud() {
  const lines = [
    'phase 1: ECS + 30Hz sim',
    `entities: ${world.entityCount}  archetypes: ${world.archetypes.size}`,
    `sim: tick=${loop.tick}  Hz=${loop.measuredHz.toFixed(0)}/30  steps/frame=${loop.lastSteps}`,
    `render: ${measuredFps.toFixed(0)} fps`,
    'systems (avg ms):',
  ];
  for (const sys of scheduler.systems) {
    const avg = scheduler.avgMs.get(sys.name) ?? 0;
    lines.push(`  ${sys.name}: ${avg.toFixed(3)}ms`);
  }
  hud.innerText = lines.join('\n');
}

loop.start();
updateHud();
