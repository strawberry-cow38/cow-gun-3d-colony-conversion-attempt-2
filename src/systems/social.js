/**
 * Social chit-chat tick. Pairs nearby cows, gates on idleness + cooldown,
 * picks a topic + verb, writes a transient `Chat` bubble on one of them,
 * and nudges both parties' mutual opinion.
 *
 * Runs on the 'rare' tier — eight real ticks between passes, fine for
 * "someone might start talking" granularity without burning hot-path CPU.
 * The proximity hash is built fresh each pass from the cow query since
 * cow counts are modest and a new cow joining mid-game would otherwise
 * need invalidation wiring.
 */

import { clampOpinion, composeChat, opinionDelta, pickTopic, pickVerb } from '../world/chitchat.js';
import { TILE_SIZE } from '../world/coords.js';

const CHAT_RADIUS = TILE_SIZE * 2.5;
const CHAT_RADIUS_SQ = CHAT_RADIUS * CHAT_RADIUS;
// Bubble lifetime (in sim ticks). At 30Hz sim → ~3 real seconds.
const BUBBLE_TICKS = 90;
// Minimum gap between chats between the same pair. ~10 real sec @30Hz.
const PAIR_COOLDOWN_TICKS = 300;
// Per-tick chance a candidate pair actually strikes up a conversation.
// With tier='rare' this system only ticks every 8 sim ticks, so the
// effective rate is BASE_CHANCE / 8 per tick. Current value yields
// roughly "one chat every ~20 seconds per idle pair within range".
const BASE_CHANCE = 0.22;

// Cell grid for the proximity scan. Cell = CHAT_RADIUS so any interesting
// neighbor lives in self + the 3×3 surrounding bucket window.
const CELL_SIZE = CHAT_RADIUS;
const CELL_OFFSET = 1024;
const CELL_STRIDE = 2048;

/**
 * @param {{ rng?: () => number }} [opts]
 * @returns {import('../ecs/schedule.js').SystemDef}
 */
export function makeSocialSystem(opts = {}) {
  const rng = opts.rng ?? Math.random;
  return {
    name: 'social',
    tier: 'rare',
    run(world, ctx) {
      /** @type {Map<number, number[]>} */
      const cells = new Map();
      /** @type {{ id: number, x: number, z: number, idle: boolean, hasChat: boolean, chat: { text: string, partnerId: number, expiresAtTick: number }, opinions: { scores: Record<number, number>, last: Record<number, { text: string, tick: number }>, chats: number } }[]} */
      const cows = [];

      for (const { id, components } of world.query([
        'Cow',
        'Position',
        'Job',
        'Opinions',
        'Chat',
      ])) {
        // A cow with a live bubble is already "speaking" — they can still
        // listen but we won't overwrite their text mid-line.
        const chat = components.Chat;
        const hasChat = chat.expiresAtTick > ctx.tick;
        const job = components.Job;
        // Sleeping cows don't chat at all — not while pathing to bed, not
        // while mattress-bound. Excluding them here keeps them out of the
        // proximity grid so a walking neighbor can't strike up a conversation.
        if (job.kind === 'sleep') continue;
        const idle = job.kind === 'none' || job.kind === 'wander';
        const pos = components.Position;
        const entry = {
          id,
          x: pos.x,
          z: pos.z,
          idle,
          hasChat,
          chat,
          opinions: components.Opinions,
        };
        cows.push(entry);
        const ix = Math.floor(pos.x / CELL_SIZE);
        const iz = Math.floor(pos.z / CELL_SIZE);
        const key = (ix + CELL_OFFSET) * CELL_STRIDE + (iz + CELL_OFFSET);
        let bucket = cells.get(key);
        if (!bucket) {
          bucket = [];
          cells.set(key, bucket);
        }
        bucket.push(cows.length - 1);
      }

      // Visit each cow and see if it strikes up a chat with any adjacent cow.
      // Pair dedup via id ordering so we don't evaluate (a,b) and (b,a) both.
      for (let idx = 0; idx < cows.length; idx++) {
        const self = cows[idx];
        if (self.hasChat) continue;
        const ix = Math.floor(self.x / CELL_SIZE);
        const iz = Math.floor(self.z / CELL_SIZE);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            const key = (ix + dx + CELL_OFFSET) * CELL_STRIDE + (iz + dz + CELL_OFFSET);
            const bucket = cells.get(key);
            if (!bucket) continue;
            for (const otherIdx of bucket) {
              if (otherIdx <= idx) continue;
              const other = cows[otherIdx];
              const ddx = self.x - other.x;
              const ddz = self.z - other.z;
              if (ddx * ddx + ddz * ddz > CHAT_RADIUS_SQ) continue;
              // Gate on idleness — busy cows chat less. Both idle → full
              // rate; one idle → half; neither idle → still non-zero so
              // working colonies still have background chatter.
              const idleBoost = self.idle && other.idle ? 1 : self.idle || other.idle ? 0.55 : 0.25;

              // Cooldown: skip if this pair chatted recently.
              const selfOp = self.opinions;
              const otherOp = other.opinions;
              const lastSelf = selfOp.last[other.id];
              if (lastSelf && ctx.tick - lastSelf.tick < PAIR_COOLDOWN_TICKS) continue;

              if (rng() >= BASE_CHANCE * idleBoost) continue;

              // Speaker chosen randomly so bubbles alternate over time.
              const selfSpeaks = rng() < 0.5;
              const speaker = selfSpeaks ? self : other;
              const listener = selfSpeaks ? other : self;
              const speakerOp = speaker.opinions;
              const listenerOp = listener.opinions;

              const opinion = speakerOp.scores[listener.id] ?? 0;
              const topic = pickTopic(opinion, rng);
              const verb = pickVerb(opinion, rng);
              const text = composeChat(verb, topic);

              speaker.chat.text = text;
              speaker.chat.partnerId = listener.id;
              speaker.chat.expiresAtTick = ctx.tick + BUBBLE_TICKS;

              // Opinion is symmetric-ish — both parties update their score of
              // the other. Using separate computations lets traits diverge
              // later (e.g. a snobby listener might gain less).
              const d1 = opinionDelta(opinion, topic);
              const d2 = opinionDelta(listenerOp.scores[speaker.id] ?? 0, topic);
              speakerOp.scores[listener.id] = clampOpinion(
                (speakerOp.scores[listener.id] ?? 0) + d1,
              );
              listenerOp.scores[speaker.id] = clampOpinion(
                (listenerOp.scores[speaker.id] ?? 0) + d2,
              );
              speakerOp.last[listener.id] = { text, tick: ctx.tick };
              listenerOp.last[speaker.id] = { text, tick: ctx.tick };
              speakerOp.chats++;
              listenerOp.chats++;

              self.hasChat = true;
              other.hasChat = true;
              break;
            }
            if (self.hasChat) break;
          }
          if (self.hasChat) break;
        }
      }
    },
  };
}
