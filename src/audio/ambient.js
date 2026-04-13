/**
 * Looping ambient sound generators.
 *
 * Contract is `(ctx, dest) => stopFn` — each generator builds a long-lived
 * node graph and returns a teardown function that fades the gain out and
 * disconnects. Same pluggable-later story as the one-shots: swapping in a
 * sample loader later is a single-function replacement per kind.
 */

/** @typedef {(ctx: AudioContext, dest: AudioNode) => () => void} LoopSfxGenerator */

/**
 * Pink noise via the Paul Kellet approximation, then filtered into a soft
 * overcast shower. A 2-second buffer with `loop=true` avoids the cost of
 * streaming; the filters mask the loop seam well enough that it's inaudible.
 *
 * @type {LoopSfxGenerator}
 */
export function playRainLoop(ctx, dest) {
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
  gain.gain.linearRampToValueAtTime(0.32, t + 1.0);

  src.connect(hp).connect(lp).connect(gain).connect(dest);
  src.start(t);

  return () => {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.6);
    try {
      src.stop(now + 0.65);
    } catch {
      /* already stopped */
    }
    setTimeout(() => {
      try {
        src.disconnect();
        hp.disconnect();
        lp.disconnect();
        gain.disconnect();
      } catch {
        /* already disconnected */
      }
    }, 700);
  };
}
