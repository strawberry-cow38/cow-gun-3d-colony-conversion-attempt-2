/**
 * Human anatomy used by the medical system. A colonist's Health component
 * stores a flat list of Injury records; body-part HP and capacity levels are
 * *derived* on read from that list against this static anatomy table.
 *
 * The anatomy is a flat array of parts, each optionally pointing at a parent
 * by id. Parents are pure containers (Head, Torso) — they have no HP or
 * capacity contribution themselves; the organs and limbs underneath them do
 * the work. This keeps the compute loop a single pass over parts.
 *
 * Capacity contributions are a weighted sum: each capacity is a list of
 * (partId, weight) tuples whose weights sum to ~1.0. A fully healthy part
 * delivers its weight; a half-destroyed part delivers half of it. Parts
 * marked `vital` cause death when their HP drops to zero — the render just
 * reports "dead" and downstream systems will react later.
 *
 * Explicitly human-shaped: head + torso + organs + two arms + two legs.
 * Cows in this build are placeholders for humans (see memory:
 * project_colony_sim_cows_to_humans), and the UI is already calling them
 * "colonists" everywhere. When non-human species are added later they'll
 * get their own anatomy table and the Health component will reference one
 * by species id.
 */

/**
 * @typedef {'head' | 'torso' | 'arm' | 'leg'} BodyRegion
 */

/**
 * @typedef {Object} CapacityContribution
 * @property {string} partId
 * @property {number} weight  0..1 share of the capacity contributed by this part
 */

/**
 * @typedef {Object} BodyPart
 * @property {string} id          unique within anatomy
 * @property {string} label       display name
 * @property {string | null} parentId
 * @property {BodyRegion} region
 * @property {number} maxHp
 * @property {boolean} [vital]    destruction = death
 * @property {boolean} [solo]     metadata hint — UI doesn't pair a label with L/R
 */

/** @type {BodyPart[]} */
export const HUMAN_ANATOMY = [
  { id: 'head', label: 'Head', parentId: null, region: 'head', maxHp: 0, solo: true },
  { id: 'skull', label: 'Skull', parentId: 'head', region: 'head', maxHp: 25, solo: true },
  {
    id: 'brain',
    label: 'Brain',
    parentId: 'head',
    region: 'head',
    maxHp: 10,
    solo: true,
    vital: true,
  },
  { id: 'left_eye', label: 'Left Eye', parentId: 'head', region: 'head', maxHp: 10 },
  { id: 'right_eye', label: 'Right Eye', parentId: 'head', region: 'head', maxHp: 10 },
  { id: 'left_ear', label: 'Left Ear', parentId: 'head', region: 'head', maxHp: 8 },
  { id: 'right_ear', label: 'Right Ear', parentId: 'head', region: 'head', maxHp: 8 },
  { id: 'nose', label: 'Nose', parentId: 'head', region: 'head', maxHp: 12, solo: true },
  { id: 'jaw', label: 'Jaw', parentId: 'head', region: 'head', maxHp: 20, solo: true },
  {
    id: 'neck',
    label: 'Neck',
    parentId: null,
    region: 'torso',
    maxHp: 25,
    solo: true,
    vital: true,
  },
  { id: 'torso', label: 'Torso', parentId: null, region: 'torso', maxHp: 0, solo: true },
  { id: 'ribcage', label: 'Ribcage', parentId: 'torso', region: 'torso', maxHp: 40, solo: true },
  { id: 'spine', label: 'Spine', parentId: 'torso', region: 'torso', maxHp: 30, solo: true },
  {
    id: 'heart',
    label: 'Heart',
    parentId: 'torso',
    region: 'torso',
    maxHp: 15,
    solo: true,
    vital: true,
  },
  { id: 'left_lung', label: 'Left Lung', parentId: 'torso', region: 'torso', maxHp: 18 },
  { id: 'right_lung', label: 'Right Lung', parentId: 'torso', region: 'torso', maxHp: 18 },
  {
    id: 'liver',
    label: 'Liver',
    parentId: 'torso',
    region: 'torso',
    maxHp: 18,
    solo: true,
    vital: true,
  },
  { id: 'stomach', label: 'Stomach', parentId: 'torso', region: 'torso', maxHp: 18, solo: true },
  { id: 'left_kidney', label: 'Left Kidney', parentId: 'torso', region: 'torso', maxHp: 15 },
  { id: 'right_kidney', label: 'Right Kidney', parentId: 'torso', region: 'torso', maxHp: 15 },
  { id: 'left_arm', label: 'Left Arm', parentId: null, region: 'arm', maxHp: 30 },
  { id: 'left_hand', label: 'Left Hand', parentId: 'left_arm', region: 'arm', maxHp: 20 },
  { id: 'right_arm', label: 'Right Arm', parentId: null, region: 'arm', maxHp: 30 },
  { id: 'right_hand', label: 'Right Hand', parentId: 'right_arm', region: 'arm', maxHp: 20 },
  { id: 'left_leg', label: 'Left Leg', parentId: null, region: 'leg', maxHp: 30 },
  { id: 'left_foot', label: 'Left Foot', parentId: 'left_leg', region: 'leg', maxHp: 20 },
  { id: 'right_leg', label: 'Right Leg', parentId: null, region: 'leg', maxHp: 30 },
  { id: 'right_foot', label: 'Right Foot', parentId: 'right_leg', region: 'leg', maxHp: 20 },
];

/** @type {Map<string, BodyPart>} */
const PART_BY_ID = new Map(HUMAN_ANATOMY.map((p) => [p.id, p]));

/** @param {string} partId */
export function getPart(partId) {
  return PART_BY_ID.get(partId) ?? null;
}

/**
 * @typedef {'Consciousness' | 'Moving' | 'Manipulation' | 'Sight' | 'Hearing' | 'Talking' | 'Breathing' | 'BloodPumping' | 'BloodFiltration' | 'Eating'} Capacity
 */

/** @type {Capacity[]} */
export const CAPACITIES = [
  'Consciousness',
  'Moving',
  'Manipulation',
  'Sight',
  'Hearing',
  'Talking',
  'Breathing',
  'BloodPumping',
  'BloodFiltration',
  'Eating',
];

/**
 * For each capacity, the parts that contribute and their weights. Weights
 * within a capacity sum to 1.0 so a fully healthy body produces capacity = 1.
 *
 * @type {Record<Capacity, CapacityContribution[]>}
 */
export const CAPACITY_CONTRIBUTIONS = {
  Consciousness: [{ partId: 'brain', weight: 1.0 }],
  Moving: [
    { partId: 'left_leg', weight: 0.35 },
    { partId: 'right_leg', weight: 0.35 },
    { partId: 'left_foot', weight: 0.08 },
    { partId: 'right_foot', weight: 0.08 },
    { partId: 'spine', weight: 0.14 },
  ],
  Manipulation: [
    { partId: 'left_arm', weight: 0.2 },
    { partId: 'right_arm', weight: 0.2 },
    { partId: 'left_hand', weight: 0.25 },
    { partId: 'right_hand', weight: 0.25 },
    { partId: 'spine', weight: 0.1 },
  ],
  Sight: [
    { partId: 'left_eye', weight: 0.5 },
    { partId: 'right_eye', weight: 0.5 },
  ],
  Hearing: [
    { partId: 'left_ear', weight: 0.5 },
    { partId: 'right_ear', weight: 0.5 },
  ],
  Talking: [
    { partId: 'jaw', weight: 0.6 },
    { partId: 'neck', weight: 0.4 },
  ],
  Breathing: [
    { partId: 'left_lung', weight: 0.4 },
    { partId: 'right_lung', weight: 0.4 },
    { partId: 'nose', weight: 0.1 },
    { partId: 'neck', weight: 0.1 },
  ],
  BloodPumping: [{ partId: 'heart', weight: 1.0 }],
  BloodFiltration: [
    { partId: 'liver', weight: 0.5 },
    { partId: 'left_kidney', weight: 0.25 },
    { partId: 'right_kidney', weight: 0.25 },
  ],
  Eating: [
    { partId: 'jaw', weight: 0.5 },
    { partId: 'stomach', weight: 0.3 },
    { partId: 'neck', weight: 0.2 },
  ],
};

/**
 * @typedef {'Cut' | 'Bruise' | 'Burn' | 'Bite' | 'Gunshot' | 'Frostbite' | 'Scrape' | 'Scar' | 'Fracture'} InjuryType
 */

/**
 * @typedef {Object} Injury
 * @property {number} id                stable within a Health for UI keys
 * @property {string} partId
 * @property {InjuryType} type
 * @property {number} severity          HP removed from the part while present
 * @property {number} bleedRate         per-tick bleed contribution (0 = none)
 * @property {number} infection         0..1
 * @property {boolean} tended
 * @property {number} tendQuality       0..1
 * @property {boolean} permanent        scars/missing-part markers don't heal
 * @property {number} appliedAtTick
 */

/**
 * @typedef {Object} Health
 * @property {Injury[]} injuries
 * @property {number} nextInjuryId
 * @property {boolean} dead
 */

/**
 * Clamped current HP for a part given all injuries on the body.
 *
 * @param {string} partId
 * @param {Injury[]} injuries
 */
export function partHp(partId, injuries) {
  const part = PART_BY_ID.get(partId);
  if (!part || part.maxHp <= 0) return 0;
  let dmg = 0;
  for (const inj of injuries) {
    if (inj.partId === partId) dmg += inj.severity;
  }
  return Math.max(0, part.maxHp - dmg);
}

/**
 * Part health as a 0..1 ratio (1 = pristine). Container parts (Head, Torso
 * with maxHp=0) return 1.
 *
 * @param {string} partId
 * @param {Injury[]} injuries
 */
export function partHpRatio(partId, injuries) {
  const part = PART_BY_ID.get(partId);
  if (!part || part.maxHp <= 0) return 1;
  return partHp(partId, injuries) / part.maxHp;
}

/**
 * Compute all capacity levels as 0..1 floats. A capacity's level is the sum
 * of (contributing part hp ratio × weight) across its contributions.
 *
 * @param {Injury[]} injuries
 * @returns {Record<Capacity, number>}
 */
export function computeCapacities(injuries) {
  /** @type {Record<string, number>} */
  const ratios = {};
  for (const part of HUMAN_ANATOMY) {
    ratios[part.id] = partHpRatio(part.id, injuries);
  }
  /** @type {Record<Capacity, number>} */
  const out = /** @type {any} */ ({});
  for (const cap of CAPACITIES) {
    let level = 0;
    for (const c of CAPACITY_CONTRIBUTIONS[cap]) level += (ratios[c.partId] ?? 0) * c.weight;
    // Consciousness gates everything else: if you're knocked out, nothing
    // else works past that ceiling. Rimworld-style, keeps the panel honest.
    out[cap] = Math.max(0, Math.min(1, level));
  }
  const consciousnessCap = out.Consciousness;
  for (const cap of CAPACITIES) {
    if (cap === 'Consciousness') continue;
    out[cap] = Math.min(out[cap], consciousnessCap);
  }
  return out;
}

/**
 * Summed untended-injury bleed rate. Tended injuries bleed at
 * `bleedRate * (1 - tendQuality)` — a perfectly tended wound is dry.
 *
 * @param {Injury[]} injuries
 */
export function totalBleedRate(injuries) {
  let sum = 0;
  for (const inj of injuries) {
    const factor = inj.tended ? 1 - inj.tendQuality : 1;
    sum += inj.bleedRate * factor;
  }
  return sum;
}

/**
 * Did any vital part get destroyed? Caller uses this to flag Health.dead.
 *
 * @param {Injury[]} injuries
 */
export function hasLethalDamage(injuries) {
  for (const part of HUMAN_ANATOMY) {
    if (!part.vital) continue;
    if (partHp(part.id, injuries) <= 0) return true;
  }
  return false;
}

/** Fresh, uninjured Health — call on spawn. */
export function emptyHealth() {
  return { injuries: [], nextInjuryId: 1, dead: false };
}
