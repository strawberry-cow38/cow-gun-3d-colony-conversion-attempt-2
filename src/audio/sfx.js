/**
 * Procedural SFX generators.
 *
 * Each generator is `(ctx, dest) => duration`. It builds a fresh Web-Audio
 * node graph ending at `dest` (usually a PannerNode owned by the audio
 * system), starts the sources, and returns the clip duration in seconds so
 * the caller can schedule cleanup without listening to `onended`.
 *
 * Replacing a generator with a buffer-loader sample later is a drop-in swap:
 * same signature, same contract. Keep generators cheap — they allocate nodes
 * per call and run in the hot path of cow behavior.
 */

/**
 * @typedef {(ctx: AudioContext, dest: AudioNode) => number} SfxGenerator
 */

/** @type {SfxGenerator} */
export function playChop(ctx, dest) {
  const now = ctx.currentTime;
  const dur = 0.22;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 850;
  bp.Q.value = 4;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(1.0, now + 0.004);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  src.connect(bp).connect(env).connect(dest);
  src.start(now);
  src.stop(now + dur);
  return dur;
}

/** @type {SfxGenerator} */
export function playMunch(ctx, dest) {
  const now = ctx.currentTime;
  const blip = (t, freq) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, now + t + 0.08);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now + t);
    env.gain.exponentialRampToValueAtTime(0.6, now + t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, now + t + 0.09);
    osc.connect(env).connect(dest);
    osc.start(now + t);
    osc.stop(now + t + 0.1);
  };
  blip(0, 240);
  blip(0.11, 190);
  return 0.25;
}

/** @type {SfxGenerator} */
export function playFootfall(ctx, dest) {
  const now = ctx.currentTime;
  const dur = 0.11;

  // Low-frequency thump — the weight of the foot landing.
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(130, now);
  osc.frequency.exponentialRampToValueAtTime(55, now + dur);
  const oscEnv = ctx.createGain();
  oscEnv.gain.setValueAtTime(0.0001, now);
  oscEnv.gain.exponentialRampToValueAtTime(0.5, now + 0.004);
  oscEnv.gain.exponentialRampToValueAtTime(0.001, now + dur);
  osc.connect(oscEnv).connect(dest);
  osc.start(now);
  osc.stop(now + dur);

  // Short filtered-noise shell — grit of hoof on ground.
  const bufDur = 0.05;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * bufDur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 550;
  const noiseEnv = ctx.createGain();
  noiseEnv.gain.value = 0.25;
  src.connect(lp).connect(noiseEnv).connect(dest);
  src.start(now);
  src.stop(now + bufDur);
  return dur;
}
