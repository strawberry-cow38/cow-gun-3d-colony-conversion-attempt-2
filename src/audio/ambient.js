/**
 * Looping ambient sound generators.
 *
 * Contract is `(ctx, dest, opts?) => stopFn` — each generator builds a
 * long-lived node graph and returns a teardown function that fades the gain
 * out and disconnects. `opts` lets callers tweak per-kind settings (peak gain,
 * fade durations) without reallocating the buffer when weather changes —
 * future-me can swap in sample-backed playback via the same contract.
 */

/**
 * Play a precomputed buffer on loop through an optional filter chain, with
 * symmetric fade-in/out. Shared scaffolding for rain + time-of-day loops so
 * each generator only has to build its buffer and declare its filters.
 *
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 * @param {AudioBuffer} buffer
 * @param {{
 *   gain?: number,
 *   fadeIn?: number,
 *   fadeOut?: number,
 *   filters?: { type: BiquadFilterType, frequency: number, Q?: number }[],
 * }} [opts]
 * @returns {() => void}
 */
function playBufferLoop(ctx, dest, buffer, opts = {}) {
  const target = opts.gain ?? 0.1;
  const fadeIn = opts.fadeIn ?? 3.0;
  const fadeOut = opts.fadeOut ?? 2.0;
  const filterSpecs = opts.filters ?? [];

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;

  const filters = filterSpecs.map((spec) => {
    const f = ctx.createBiquadFilter();
    f.type = spec.type;
    f.frequency.value = spec.frequency;
    if (spec.Q != null) f.Q.value = spec.Q;
    return f;
  });

  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(target, t + fadeIn);

  /** @type {AudioNode} */
  let node = src;
  for (const f of filters) {
    node.connect(f);
    node = f;
  }
  node.connect(gain).connect(dest);
  src.start(t);

  return () => {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fadeOut);
    try {
      src.stop(now + fadeOut + 0.05);
    } catch {
      /* already stopped */
    }
    setTimeout(
      () => {
        try {
          src.disconnect();
          for (const f of filters) f.disconnect();
          gain.disconnect();
        } catch {
          /* already disconnected */
        }
      },
      (fadeOut + 0.1) * 1000,
    );
  };
}

/**
 * Pink-noise bed filling `data` with soft broadband wash. Runs the Paul Kellet
 * approximation in-place; additive so callers can layer chirps on top.
 * @param {Float32Array} data
 * @param {number} amp
 */
function addPinkNoise(data, amp) {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] += (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11 * amp;
    b6 = white * 0.115926;
  }
}

/**
 * Short decaying sine burst — building block for cricket chirps and bird pips.
 * @param {Float32Array} data
 * @param {number} sr sample rate
 * @param {number} startSec
 * @param {number} durSec
 * @param {number} freq
 * @param {number} amp
 * @param {number} decay exponential decay rate (higher = shorter tail)
 * @param {number} [tremoloHz]
 */
function addChirp(data, sr, startSec, durSec, freq, amp, decay, tremoloHz = 0) {
  const startF = Math.floor(startSec * sr);
  const lenF = Math.floor(durSec * sr);
  for (let k = 0; k < lenF; k++) {
    const idx = startF + k;
    if (idx >= data.length) break;
    const ts = k / sr;
    const env = Math.exp(-ts * decay);
    const trem = tremoloHz > 0 ? 0.5 + 0.5 * Math.cos(2 * Math.PI * tremoloHz * ts) : 1;
    data[idx] += Math.sin(2 * Math.PI * freq * ts) * env * trem * amp;
  }
}

/**
 * @typedef {Object} RainLoopOpts
 * @property {number} [gain]      peak gain during the loop (default 0.16)
 * @property {number} [fadeIn]    seconds to ramp from 0 → gain (default 3.0)
 * @property {number} [fadeOut]   seconds to ramp gain → 0 on stop (default 2.0)
 *
 * @typedef {(ctx: AudioContext, dest: AudioNode, opts?: RainLoopOpts) => () => void} LoopSfxGenerator
 */

/**
 * Pink noise via the Paul Kellet approximation, then filtered into a soft
 * overcast shower. A 2-second buffer with `loop=true` avoids the cost of
 * streaming; the filters mask the loop seam well enough that it's inaudible.
 *
 * @type {LoopSfxGenerator}
 */
export function playRainLoop(ctx, dest, opts = {}) {
  const target = opts.gain ?? 0.16;
  const fadeIn = opts.fadeIn ?? 3.0;
  const fadeOut = opts.fadeOut ?? 2.0;
  const SR = ctx.sampleRate;
  const frames = SR * 2;
  const buf = ctx.createBuffer(1, frames, SR);
  const data = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < frames; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 200;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200;
  lp.Q.value = 0.7;

  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(target, t + fadeIn);

  src.connect(hp).connect(lp).connect(gain).connect(dest);
  src.start(t);

  return () => {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fadeOut);
    try {
      src.stop(now + fadeOut + 0.05);
    } catch {
      /* already stopped */
    }
    setTimeout(
      () => {
        try {
          src.disconnect();
          hp.disconnect();
          lp.disconnect();
          gain.disconnect();
        } catch {
          /* already disconnected */
        }
      },
      (fadeOut + 0.1) * 1000,
    );
  };
}

/**
 * @typedef {Object} TimeLoopOpts
 * @property {number} [gain]
 * @property {number} [fadeIn]
 * @property {number} [fadeOut]
 *
 * @typedef {(ctx: AudioContext, dest: AudioNode, opts?: TimeLoopOpts) => () => void} TimeLoopGenerator
 */

/**
 * Dawn: a bed of soft air + scattered birdsong pips. Bird pips are short
 * high-sine chirps at ~3–5kHz decaying fast; ~14 spread across a 9-second
 * buffer so the pattern doesn't loudly repeat.
 * @type {TimeLoopGenerator}
 */
export function playDawnLoop(ctx, dest, opts = {}) {
  const SR = ctx.sampleRate;
  const lenSec = 9;
  const buf = ctx.createBuffer(1, Math.floor(SR * lenSec), SR);
  const data = buf.getChannelData(0);
  addPinkNoise(data, 0.35);
  const chirps = 14;
  for (let i = 0; i < chirps; i++) {
    const start = Math.random() * (lenSec - 0.4);
    const freq = 2800 + Math.random() * 2400;
    addChirp(data, SR, start, 0.16, freq, 0.45, 22);
    if (Math.random() < 0.4) {
      addChirp(data, SR, start + 0.09, 0.12, freq * 0.9, 0.35, 28);
    }
  }
  return playBufferLoop(ctx, dest, buf, {
    gain: opts.gain ?? 0.08,
    fadeIn: opts.fadeIn ?? 4.0,
    fadeOut: opts.fadeOut ?? 3.0,
    filters: [
      { type: 'highpass', frequency: 400 },
      { type: 'lowpass', frequency: 7000 },
    ],
  });
}

/**
 * Day: quiet cicada-ish buzz bed + a couple of distant chirps. Cicadas are
 * implemented as bandpass-filtered noise (handled in the filter chain); the
 * pip motifs are seeded in the buffer itself.
 * @type {TimeLoopGenerator}
 */
export function playDayLoop(ctx, dest, opts = {}) {
  const SR = ctx.sampleRate;
  const lenSec = 6;
  const buf = ctx.createBuffer(1, Math.floor(SR * lenSec), SR);
  const data = buf.getChannelData(0);
  addPinkNoise(data, 0.5);
  // Slow amplitude pulse so the cicadas swell rather than sit flat.
  for (let i = 0; i < data.length; i++) {
    const t = i / SR;
    const pulse = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.35 * t);
    data[i] *= pulse;
  }
  for (let i = 0; i < 4; i++) {
    const start = 0.5 + Math.random() * (lenSec - 1);
    const freq = 2200 + Math.random() * 1400;
    addChirp(data, SR, start, 0.18, freq, 0.22, 18);
  }
  return playBufferLoop(ctx, dest, buf, {
    gain: opts.gain ?? 0.05,
    fadeIn: opts.fadeIn ?? 5.0,
    fadeOut: opts.fadeOut ?? 3.0,
    filters: [
      { type: 'bandpass', frequency: 4200, Q: 2.8 },
      { type: 'lowpass', frequency: 6500 },
    ],
  });
}

/**
 * Dusk: warm low wash + the first crickets starting up (sparse) + a lone
 * descending two-note call.
 * @type {TimeLoopGenerator}
 */
export function playDuskLoop(ctx, dest, opts = {}) {
  const SR = ctx.sampleRate;
  const lenSec = 7;
  const buf = ctx.createBuffer(1, Math.floor(SR * lenSec), SR);
  const data = buf.getChannelData(0);
  addPinkNoise(data, 0.4);
  // Early crickets — sparser than full night.
  const chirps = 10;
  for (let i = 0; i < chirps; i++) {
    const start = Math.random() * (lenSec - 0.2);
    const freq = 4300 + Math.random() * 600;
    addChirp(data, SR, start, 0.06, freq, 0.35, 45, 30);
  }
  // Dove coo: two descending notes near the start.
  addChirp(data, SR, 1.4, 0.22, 520, 0.28, 8);
  addChirp(data, SR, 1.75, 0.32, 420, 0.26, 6);
  return playBufferLoop(ctx, dest, buf, {
    gain: opts.gain ?? 0.07,
    fadeIn: opts.fadeIn ?? 4.0,
    fadeOut: opts.fadeOut ?? 3.0,
    filters: [
      { type: 'highpass', frequency: 250 },
      { type: 'lowpass', frequency: 5500 },
    ],
  });
}

/**
 * Night: dense cricket chirps over soft low wind. ~30 chirps across a
 * 6-second buffer — randomly placed so the loop seam is masked.
 * @type {TimeLoopGenerator}
 */
export function playNightLoop(ctx, dest, opts = {}) {
  const SR = ctx.sampleRate;
  const lenSec = 6;
  const buf = ctx.createBuffer(1, Math.floor(SR * lenSec), SR);
  const data = buf.getChannelData(0);
  addPinkNoise(data, 0.45);
  const chirps = 30;
  for (let i = 0; i < chirps; i++) {
    const start = Math.random() * (lenSec - 0.15);
    const freq = 4400 + Math.random() * 500;
    addChirp(data, SR, start, 0.05, freq, 0.4, 55, 32);
  }
  return playBufferLoop(ctx, dest, buf, {
    gain: opts.gain ?? 0.09,
    fadeIn: opts.fadeIn ?? 4.0,
    fadeOut: opts.fadeOut ?? 3.0,
    filters: [
      { type: 'highpass', frequency: 180 },
      { type: 'lowpass', frequency: 6000 },
    ],
  });
}
