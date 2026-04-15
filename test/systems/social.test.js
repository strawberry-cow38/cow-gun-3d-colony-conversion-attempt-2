import { describe, expect, it } from 'vitest';
import { registerComponents } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { makeSocialSystem } from '../../src/systems/social.js';

function makeWorld() {
  const w = new World();
  registerComponents(w);
  return w;
}

function spawnIdleCow(world, x, z) {
  return world.spawn({
    Cow: { drafted: false },
    Position: { x, y: 0, z },
    Job: { kind: 'none', state: 'idle', payload: {} },
    Opinions: { scores: {}, last: {}, chats: 0 },
    Chat: { text: '', partnerId: 0, expiresAtTick: 0 },
  });
}

describe('social chit-chat', () => {
  it('bumps both cows’ opinion scores when two idle cows stand adjacent', () => {
    const world = makeWorld();
    const a = spawnIdleCow(world, 0, 0);
    const b = spawnIdleCow(world, 1, 0);
    // Force rng < BASE_CHANCE so a chat fires on the first evaluation.
    const sys = makeSocialSystem({ rng: () => 0 });

    sys.run(world, /** @type {any} */ ({ tick: 1 }));

    const opA = world.get(a, 'Opinions');
    const opB = world.get(b, 'Opinions');
    expect(opA).toBeTruthy();
    expect(opB).toBeTruthy();
    expect(opA.chats).toBe(1);
    expect(opB.chats).toBe(1);
    expect(opA.scores[b]).toBeDefined();
    expect(opB.scores[a]).toBeDefined();
  });

  it('writes a Chat bubble on exactly one of the pair', () => {
    const world = makeWorld();
    const a = spawnIdleCow(world, 0, 0);
    const b = spawnIdleCow(world, 1, 0);
    const sys = makeSocialSystem({ rng: () => 0 });

    sys.run(world, /** @type {any} */ ({ tick: 5 }));

    const chatA = world.get(a, 'Chat');
    const chatB = world.get(b, 'Chat');
    const live = [chatA, chatB].filter((c) => c && c.expiresAtTick > 5);
    expect(live.length).toBe(1);
    expect(live[0].text.length).toBeGreaterThan(0);
  });

  it('skips pairs whose last chat is inside the cooldown window', () => {
    const world = makeWorld();
    const a = spawnIdleCow(world, 0, 0);
    const b = spawnIdleCow(world, 1, 0);
    const opA = world.get(a, 'Opinions');
    opA.last[b] = { text: 'old', tick: 0 };
    const opB = world.get(b, 'Opinions');
    opB.last[a] = { text: 'old', tick: 0 };
    const sys = makeSocialSystem({ rng: () => 0 });

    sys.run(world, /** @type {any} */ ({ tick: 10 }));

    expect(opA.chats).toBe(0);
    expect(opB.chats).toBe(0);
  });

  it('does not chat with a cow out of range', () => {
    const world = makeWorld();
    const a = spawnIdleCow(world, 0, 0);
    // 10 tiles apart → well beyond CHAT_RADIUS.
    const b = spawnIdleCow(world, 10000, 0);
    const sys = makeSocialSystem({ rng: () => 0 });

    sys.run(world, /** @type {any} */ ({ tick: 1 }));

    expect(world.get(a, 'Opinions').chats).toBe(0);
    expect(world.get(b, 'Opinions').chats).toBe(0);
  });
});
