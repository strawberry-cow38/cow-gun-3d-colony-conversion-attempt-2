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
export function playHammer(ctx, dest) {
  const now = ctx.currentTime;
  const dur = 0.14;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  // Tight bandpass around ~1500Hz gives the metallic "tink" of a hammer, well
  // clear of chop's 850Hz wood thud so the two don't blur together.
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1500;
  bp.Q.value = 8;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(0.9, now + 0.003);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  src.connect(bp).connect(env).connect(dest);
  src.start(now);
  src.stop(now + dur);
  return dur;
}

/**
 * Thunder clap. Two layers:
 *   - sharp filtered-noise crack (~0.25s) for the initial slap of the strike
 *   - long lowpassed rumble (~3s) for the rolling tail
 * Random crackle on the way down adds the irregular boom-boom that makes
 * synthetic thunder feel less like a single envelope.
 *
 * @type {SfxGenerator}
 */
export function playThunder(ctx, dest) {
  const now = ctx.currentTime;
  const dur = 3.2;
  const SR = ctx.sampleRate;

  // Crack: short bright noise burst, bandpassed around 700Hz.
  const crackBuf = ctx.createBuffer(1, Math.ceil(SR * 0.3), SR);
  const crackData = crackBuf.getChannelData(0);
  for (let i = 0; i < crackData.length; i++) crackData[i] = Math.random() * 2 - 1;
  const crackSrc = ctx.createBufferSource();
  crackSrc.buffer = crackBuf;
  const crackBp = ctx.createBiquadFilter();
  crackBp.type = 'bandpass';
  crackBp.frequency.value = 700;
  crackBp.Q.value = 1.2;
  const crackEnv = ctx.createGain();
  crackEnv.gain.setValueAtTime(0.0001, now);
  crackEnv.gain.exponentialRampToValueAtTime(0.85, now + 0.01);
  crackEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
  crackSrc.connect(crackBp).connect(crackEnv).connect(dest);
  crackSrc.start(now);
  crackSrc.stop(now + 0.3);

  // Rumble: 3s of lowpassed brown-ish noise with a slow envelope and a couple
  // of mid-roll bumps to simulate the rolling boom.
  const rumbleBuf = ctx.createBuffer(1, Math.ceil(SR * dur), SR);
  const rumbleData = rumbleBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < rumbleData.length; i++) {
    // Brownish noise: integrate white noise then leak slowly.
    last = (last + (Math.random() * 2 - 1) * 0.04) * 0.995;
    rumbleData[i] = last;
  }
  const rumbleSrc = ctx.createBufferSource();
  rumbleSrc.buffer = rumbleBuf;
  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = 'lowpass';
  rumbleLp.frequency.value = 220;
  rumbleLp.Q.value = 0.9;
  const rumbleEnv = ctx.createGain();
  rumbleEnv.gain.setValueAtTime(0.0001, now);
  rumbleEnv.gain.exponentialRampToValueAtTime(0.95, now + 0.05);
  rumbleEnv.gain.exponentialRampToValueAtTime(0.55, now + 0.6);
  rumbleEnv.gain.exponentialRampToValueAtTime(0.85, now + 1.1);
  rumbleEnv.gain.exponentialRampToValueAtTime(0.4, now + 1.8);
  rumbleEnv.gain.exponentialRampToValueAtTime(0.001, now + dur);
  rumbleSrc.connect(rumbleLp).connect(rumbleEnv).connect(dest);
  rumbleSrc.start(now);
  rumbleSrc.stop(now + dur);

  return dur;
}

/**
 * Wooden door creak. A short bandpass-noise burst with the filter center
 * sweeping up slightly — suggests a hinge rotating under load. Tight Q keeps
 * it clearly pitched so it reads as "door", not just more world noise.
 *
 * @type {SfxGenerator}
 */
export function playDoor(ctx, dest) {
  const now = ctx.currentTime;
  const dur = 0.36;
  const SR = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.ceil(SR * dur), SR);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 12;
  bp.frequency.setValueAtTime(260, now);
  bp.frequency.exponentialRampToValueAtTime(440, now + dur);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(0.55, now + 0.035);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  src.connect(bp).connect(env).connect(dest);
  src.start(now);
  src.stop(now + dur);
  return dur;
}

/** @type {SfxGenerator} */
export function playSplash(ctx, dest) {
  // A short wet "splish" — highpassed white noise with a fast attack and a
  // slightly longer decay than footfall, plus a tiny pitched "plip" on top so
  // it reads as water-on-hoof and not just general rustle.
  const now = ctx.currentTime;
  const dur = 0.22;

  const bufDur = 0.2;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * bufDur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * (1 - t) ** 1.8;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2800, now);
  bp.frequency.exponentialRampToValueAtTime(1400, now + dur);
  bp.Q.value = 1.4;
  const noiseEnv = ctx.createGain();
  noiseEnv.gain.setValueAtTime(0.0001, now);
  noiseEnv.gain.exponentialRampToValueAtTime(0.45, now + 0.008);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(bp).connect(noiseEnv).connect(dest);
  src.start(now);
  src.stop(now + bufDur);

  // Pitched plip — sine that drops an octave, gives the "droplet" quality.
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(900, now);
  osc.frequency.exponentialRampToValueAtTime(380, now + 0.08);
  const oscEnv = ctx.createGain();
  oscEnv.gain.setValueAtTime(0.0001, now);
  oscEnv.gain.exponentialRampToValueAtTime(0.18, now + 0.006);
  oscEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(oscEnv).connect(dest);
  osc.start(now);
  osc.stop(now + 0.13);

  return dur;
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
