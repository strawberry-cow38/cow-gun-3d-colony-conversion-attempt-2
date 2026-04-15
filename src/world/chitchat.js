/**
 * Chit-chat content pool: topics a cow might bring up when gabbing with a
 * nearby pal, plus the verbs a speech-bubble uses to describe the act of
 * talking. The social system picks one verb + one topic per interaction and
 * composes a short bubble line like "babbled about the weather".
 *
 * Each topic carries a `valence` in [-1, +1]:
 *   +1  warm/bonding — pushes opinion up hard
 *    0  neutral small talk — modest bump
 *   -1  gripe/complaint — still bonds friends, but sours foes
 *
 * Picking is weighted by the pair's existing opinion so best friends mostly
 * share sunny gossip and enemies mostly squabble.
 */

/**
 * @typedef {Object} Topic
 * @property {string} text
 * @property {number} valence -1..+1
 */

/** @type {Topic[]} */
export const TOPICS = [
  // --- warm / bonding ---
  { text: 'the weather', valence: 0 },
  { text: 'a good dream', valence: 0.8 },
  { text: 'a funny story', valence: 0.9 },
  { text: 'the sunset last night', valence: 0.7 },
  { text: 'a soft patch of grass', valence: 0.6 },
  { text: 'how cute calves are', valence: 0.9 },
  { text: 'their favorite meadow', valence: 0.7 },
  { text: 'a song stuck in their head', valence: 0.7 },
  { text: 'how nice the breeze feels', valence: 0.6 },
  { text: 'a warm spot by the furnace', valence: 0.6 },
  { text: 'a painting they admire', valence: 0.8 },
  { text: 'constellations', valence: 0.7 },
  { text: 'childhood memories', valence: 0.9 },
  { text: 'fresh morning dew', valence: 0.6 },
  { text: 'a cozy nap corner', valence: 0.7 },
  { text: 'a clever trick they learned', valence: 0.8 },
  { text: 'compliments about horns', valence: 1.0 },
  { text: 'a beautiful butterfly', valence: 0.8 },
  { text: 'plans for a feast', valence: 0.9 },

  // --- neutral small talk ---
  { text: 'the price of hay', valence: 0 },
  { text: 'which crop grows best', valence: 0 },
  { text: 'whether to plant corn or potato', valence: 0 },
  { text: 'the next full moon', valence: 0 },
  { text: 'an odd cloud shape', valence: 0 },
  { text: 'the sound of rain on the roof', valence: 0.4 },
  { text: 'bedding arrangements', valence: 0 },
  { text: 'last night\u2019s supper', valence: 0.3 },
  { text: 'the state of the fence', valence: -0.2 },
  { text: 'whose turn it is to haul', valence: -0.1 },
  { text: 'leftover firewood', valence: 0 },
  { text: 'a weird noise in the barn', valence: -0.2 },
  { text: 'a distant bird call', valence: 0.3 },
  { text: 'the shape of a cloud', valence: 0.2 },
  { text: 'the color of the dirt today', valence: 0 },
  { text: 'philosophy', valence: 0.1 },
  { text: 'whether flies have feelings', valence: 0.1 },
  { text: 'how many hours they slept', valence: 0 },
  { text: 'a rock they tripped over', valence: -0.3 },

  // --- gripes / complaints ---
  { text: 'a lumpy pillow', valence: -0.4 },
  { text: 'how slow the haulers are', valence: -0.6 },
  { text: 'yesterday\u2019s bland supper', valence: -0.5 },
  { text: 'how loud the furnace is', valence: -0.4 },
  { text: 'the neighbor\u2019s snoring', valence: -0.5 },
  { text: 'a stolen turnip', valence: -0.7 },
  { text: 'rude behavior at the feast', valence: -0.7 },
  { text: 'who forgot to close the door', valence: -0.5 },
  { text: 'a grumpy rooster', valence: -0.3 },
  { text: 'an unfair chore schedule', valence: -0.6 },
  { text: 'how cold the floor is', valence: -0.3 },
  { text: 'that one annoying fly', valence: -0.4 },
  { text: 'a suspicious smell', valence: -0.5 },
  { text: 'the long walk to the well', valence: -0.4 },
  { text: 'getting rained on', valence: -0.4 },
  { text: 'an old grudge', valence: -0.9 },
  { text: 'politics', valence: -0.5 },
  { text: 'something someone said last week', valence: -0.6 },
  { text: 'how badly the roof leaks', valence: -0.6 },
  { text: 'a missing sock', valence: -0.2 },
  { text: 'who hogged the fire pit', valence: -0.5 },
];

/**
 * Verbs of speaking. Mostly neutral-to-warm — the valence of the topic does
 * the heavy lifting. A few leaning-positive verbs are hinted by `mood`:
 *   'warm'    — used more often between friends (gushed, purred, beamed)
 *   'sour'    — used more often between foes (grumbled, snapped, hissed)
 *   'neutral' — anyone
 *
 * @typedef {Object} Verb
 * @property {string} past simple past, for "X babbled about Y"
 * @property {'warm'|'sour'|'neutral'} mood
 */

/** @type {Verb[]} */
export const VERBS = [
  { past: 'babbled', mood: 'neutral' },
  { past: 'chattered', mood: 'neutral' },
  { past: 'rambled', mood: 'neutral' },
  { past: 'chatted', mood: 'neutral' },
  { past: 'prattled', mood: 'neutral' },
  { past: 'jabbered', mood: 'neutral' },
  { past: 'mumbled', mood: 'neutral' },
  { past: 'murmured', mood: 'neutral' },
  { past: 'whispered', mood: 'neutral' },
  { past: 'nattered', mood: 'neutral' },
  { past: 'yammered', mood: 'neutral' },
  { past: 'rattled on', mood: 'neutral' },
  { past: 'went on', mood: 'neutral' },
  { past: 'opined', mood: 'neutral' },
  { past: 'mused', mood: 'neutral' },
  { past: 'philosophized', mood: 'neutral' },
  { past: 'pondered aloud', mood: 'neutral' },
  { past: 'speculated', mood: 'neutral' },
  { past: 'recounted a tale', mood: 'warm' },

  // warm-leaning
  { past: 'gushed', mood: 'warm' },
  { past: 'beamed', mood: 'warm' },
  { past: 'giggled', mood: 'warm' },
  { past: 'swooned', mood: 'warm' },
  { past: 'cooed', mood: 'warm' },
  { past: 'chuckled', mood: 'warm' },
  { past: 'laughed', mood: 'warm' },
  { past: 'reminisced', mood: 'warm' },
  { past: 'confided', mood: 'warm' },
  { past: 'purred', mood: 'warm' },
  { past: 'hummed', mood: 'warm' },
  { past: 'whispered sweetly', mood: 'warm' },

  // sour-leaning
  { past: 'grumbled', mood: 'sour' },
  { past: 'griped', mood: 'sour' },
  { past: 'snapped', mood: 'sour' },
  { past: 'hissed', mood: 'sour' },
  { past: 'scoffed', mood: 'sour' },
  { past: 'huffed', mood: 'sour' },
  { past: 'groused', mood: 'sour' },
  { past: 'sniped', mood: 'sour' },
  { past: 'muttered', mood: 'sour' },
  { past: 'whinged', mood: 'sour' },
  { past: 'snarked', mood: 'sour' },
  { past: 'complained', mood: 'sour' },
  { past: 'harrumphed', mood: 'sour' },
];

/**
 * Pick one `Verb` weighted by the pair's opinion level. Friends pull warm
 * verbs in, foes pull sour ones, strangers stay neutral.
 *
 * @param {number} opinion current opinion score (-100..+100)
 * @param {() => number} rng
 */
export function pickVerb(opinion, rng) {
  const bias = opinion / 100;
  let total = 0;
  const weights = VERBS.map((v) => {
    const w =
      v.mood === 'warm'
        ? Math.max(0.2, 1 + bias * 2)
        : v.mood === 'sour'
          ? Math.max(0.2, 1 - bias * 2)
          : 1;
    total += w;
    return w;
  });
  let r = rng() * total;
  for (let i = 0; i < VERBS.length; i++) {
    r -= weights[i];
    if (r <= 0) return VERBS[i];
  }
  return VERBS[VERBS.length - 1];
}

/**
 * Pick one `Topic` weighted by the pair's opinion level. Enemies mostly
 * gripe, friends mostly bond, everyone small-talks in the middle.
 *
 * @param {number} opinion
 * @param {() => number} rng
 */
export function pickTopic(opinion, rng) {
  const bias = opinion / 100; // +1 friends, -1 enemies
  let total = 0;
  const weights = TOPICS.map((t) => {
    const alignment = t.valence * bias;
    const w = Math.max(0.15, 1 + alignment * 2);
    total += w;
    return w;
  });
  let r = rng() * total;
  for (let i = 0; i < TOPICS.length; i++) {
    r -= weights[i];
    if (r <= 0) return TOPICS[i];
  }
  return TOPICS[TOPICS.length - 1];
}

/**
 * Compose a short phrase used as the speech-bubble text. Keep it tight —
 * renders at ~40-char cap well before wrapping on the canvas.
 *
 * @param {Verb} verb
 * @param {Topic} topic
 */
export function composeChat(verb, topic) {
  return `${verb.past} about ${topic.text}`;
}

/**
 * How much a single chat bumps the pair's opinion. Friendly topics shared
 * between strangers are the biggest positive swing; shared gripes are
 * mid-positive (complaining together DOES bond); cross-aligned chats
 * (warm topic with a foe, gripe with a friend) slightly sour the score.
 *
 * @param {number} opinion current opinion of partner
 * @param {Topic} topic
 */
export function opinionDelta(opinion, topic) {
  const bias = opinion / 100; // +1 friends, -1 foes
  // base bump for merely interacting — small, positive, but decays as the
  // existing opinion approaches its floor/ceiling so scores don't runaway.
  const headroom = 1 - Math.abs(bias);
  const base = 0.6 * headroom;
  // alignment = +1 when topic matches pair mood (friend+warm, foe+gripe).
  const alignment = topic.valence * bias;
  return Math.round((base + alignment * 1.6) * 10) / 10;
}

/** @param {number} score */
export function clampOpinion(score) {
  if (score > 100) return 100;
  if (score < -100) return -100;
  return score;
}

/**
 * Opinion → short label for the Social tab. Thresholds match RimWorld-style
 * "Rival / Acquaintance / Friend" buckets since players already have a
 * mental model for that scale.
 *
 * @param {number} score
 */
export function opinionLabel(score) {
  if (score >= 80) return 'LOVE!!';
  if (score >= 50) return 'best friend';
  if (score >= 25) return 'friend';
  if (score >= 10) return 'friendly';
  if (score > -10) return 'acquaintance';
  if (score > -25) return 'cool on';
  if (score > -50) return 'dislike';
  if (score > -80) return 'rival';
  return 'HATE!!';
}
