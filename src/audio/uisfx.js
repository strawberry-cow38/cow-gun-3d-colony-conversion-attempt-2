/**
 * Non-spatial UI sound generators.
 *
 * Same (ctx, dest) => duration contract as the spatial SFX so the audio
 * engine can treat them uniformly — the only difference is that UI sounds
 * feed the master gain directly, not a PannerNode. That's why they live in
 * their own registry and are invoked via `audio.play(kind)` instead of
 * `audio.playAt(kind, pos)`.
 *
 * Everything here is a few oscillators + envelopes. Replacing any generator
 * with a sample loader later is a one-function swap.
 */

/** @typedef {(ctx: AudioContext, dest: AudioNode) => number} UiSfxGenerator */

/**
 * Short attack-decay envelope on a gain node.
 * @param {AudioContext} ctx
 * @param {number} t0
 * @param {number} peak
 * @param {number} attack
 * @param {number} decay
 */
function envGain(ctx, t0, peak, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + attack + decay);
  return g;
}

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 * @param {OscillatorType} type
 * @param {number} freq
 * @param {number} t0
 * @param {number} dur
 * @param {number} peak
 */
function blip(ctx, dest, type, freq, t0, dur, peak) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = envGain(ctx, t0, peak, 0.005, dur);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** @type {UiSfxGenerator} — soft click (cow select, HUD toggle) */
export function playClick(ctx, dest) {
  const t = ctx.currentTime;
  blip(ctx, dest, 'sine', 900, t, 0.04, 0.35);
  return 0.06;
}

/** @type {UiSfxGenerator} — firmer click (move command, mark, spawn confirm) */
export function playCommand(ctx, dest) {
  const t = ctx.currentTime;
  blip(ctx, dest, 'square', 520, t, 0.06, 0.25);
  blip(ctx, dest, 'sine', 1040, t + 0.015, 0.05, 0.18);
  return 0.1;
}

/** @type {UiSfxGenerator} — rising two-tone (mode/follow/debug ON) */
export function playToggleOn(ctx, dest) {
  const t = ctx.currentTime;
  blip(ctx, dest, 'triangle', 520, t, 0.06, 0.3);
  blip(ctx, dest, 'triangle', 780, t + 0.055, 0.08, 0.3);
  return 0.15;
}

/** @type {UiSfxGenerator} — falling two-tone (mode/follow/debug OFF) */
export function playToggleOff(ctx, dest) {
  const t = ctx.currentTime;
  blip(ctx, dest, 'triangle', 780, t, 0.06, 0.3);
  blip(ctx, dest, 'triangle', 520, t + 0.055, 0.08, 0.3);
  return 0.15;
}

/** @type {UiSfxGenerator} — two ascending notes (save) */
export function playSave(ctx, dest) {
  const t = ctx.currentTime;
  blip(ctx, dest, 'sine', 660, t, 0.09, 0.32);
  blip(ctx, dest, 'sine', 880, t + 0.08, 0.12, 0.32);
  return 0.22;
}

/** @type {UiSfxGenerator} — three-note chime (load) */
export function playLoad(ctx, dest) {
  const t = ctx.currentTime;
  blip(ctx, dest, 'sine', 523, t, 0.1, 0.28); // C5
  blip(ctx, dest, 'sine', 659, t + 0.08, 0.1, 0.28); // E5
  blip(ctx, dest, 'sine', 784, t + 0.16, 0.16, 0.28); // G5
  return 0.35;
}

/** @type {UiSfxGenerator} — low brassy tone with harmonic (draft on) */
export function playDraft(ctx, dest) {
  const t = ctx.currentTime;
  blip(ctx, dest, 'sawtooth', 220, t, 0.16, 0.22);
  blip(ctx, dest, 'triangle', 440, t + 0.02, 0.14, 0.14);
  return 0.2;
}

/** @type {UiSfxGenerator} — softer tone (draft off / release) */
export function playUndraft(ctx, dest) {
  const t = ctx.currentTime;
  blip(ctx, dest, 'triangle', 330, t, 0.14, 0.22);
  return 0.16;
}

/** @type {UiSfxGenerator} — bubble pop (spawn) */
export function playSpawn(ctx, dest) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
  const g = envGain(ctx, t, 0.28, 0.008, 0.12);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + 0.15);
  return 0.15;
}

/** @type {UiSfxGenerator} — muted clunk (drop item) */
export function playDrop(ctx, dest) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.1);
  const g = envGain(ctx, t, 0.35, 0.005, 0.12);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + 0.15);
  return 0.15;
}

/** @type {UiSfxGenerator} — short tick (Q/E cycle) */
export function playCycle(ctx, dest) {
  const t = ctx.currentTime;
  blip(ctx, dest, 'square', 1200, t, 0.03, 0.15);
  return 0.05;
}

/** @type {UiSfxGenerator} — error / can't-do buzz (for later hookup) */
export function playDeny(ctx, dest) {
  const t = ctx.currentTime;
  blip(ctx, dest, 'square', 180, t, 0.1, 0.2);
  blip(ctx, dest, 'square', 140, t + 0.06, 0.1, 0.2);
  return 0.2;
}
