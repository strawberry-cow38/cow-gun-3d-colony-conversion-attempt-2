/**
 * Background-music player.
 *
 * Plays one track from `public/music/*.ogg` to completion, waits a short gap,
 * then picks another. Tracks are drawn from a shuffle bag so we don't replay
 * the same song back-to-back until the whole set has played once.
 *
 * Pipes the <audio> element through a MediaElementSource into the shared
 * AudioContext so the master gain knob affects music too. Autoplay policy
 * means the first track only starts after the first user gesture — the
 * audio factory's `resume()` handler calls `start()` for us.
 */

const TRACKS = [
  { name: 'In the Hall of the Mountain King', url: '/music/in-the-hall-of-the-mountain-king.ogg' },
  { name: 'Gymnopédie No. 1', url: '/music/gymnopedie_no_1.ogg' },
  { name: 'Dance of the Sugar Plum Fairy', url: '/music/dance_of_the_sugar.ogg' },
  { name: 'Sneaky Snitch', url: '/music/sneaky_snitch.ogg' },
  { name: 'Divertissement Pizzicato', url: '/music/divertissemet_pizzicato.ogg' },
  { name: 'Ranz des Vaches', url: '/music/Ranz_des_Vaches.ogg' },
  { name: 'Prelude in C', url: '/music/Prelude_in_C.ogg' },
  { name: 'Peer Gynt Suite No. 1: Morning', url: '/music/Peer_Gynt_Suite_No_1_Morning.ogg' },
  { name: 'Symphony No. 9', url: '/music/Symphony_No._9.ogg' },
];

/**
 * @param {{
 *   ctx: AudioContext,
 *   master: AudioNode,
 *   gain?: number,
 *   gapMinSec?: number,
 *   gapMaxSec?: number,
 * }} opts
 */
export function createMusic({ ctx, master, gain = 0.28, gapMinSec = 6, gapMaxSec = 18 }) {
  /** @type {HTMLAudioElement | null} */
  let audio = null;
  /** @type {MediaElementAudioSourceNode | null} */
  let source = null;
  /** @type {GainNode | null} */
  let gainNode = null;
  /** @type {(() => void) | null} */
  let onEnd = null;
  /** @type {(() => void) | null} */
  let onError = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let gapTimer = null;
  let running = false;
  /** @type {typeof TRACKS} */
  let bag = [];
  /** @type {(typeof TRACKS)[number] | null} */
  let currentTrack = null;

  function refillBag() {
    bag = TRACKS.slice();
    // Fisher-Yates shuffle.
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }

  function pickNext() {
    if (bag.length === 0) refillBag();
    // Avoid immediate-repeat when a new bag's first track matches the one
    // just played (possible because bag order is independent per refill).
    if (bag.length > 1 && currentTrack && bag[bag.length - 1].url === currentTrack.url) {
      const swapIdx = bag.length - 2;
      [bag[bag.length - 1], bag[swapIdx]] = [bag[swapIdx], bag[bag.length - 1]];
    }
    return bag.pop() ?? null;
  }

  function cleanupCurrent() {
    if (audio) {
      // `{ once: true }` only removes the listener that fires — the other
      // sticks around and keeps the Audio element (and its buffer) reachable.
      // Remove both explicitly before nulling the ref.
      if (onEnd) audio.removeEventListener('ended', onEnd);
      if (onError) audio.removeEventListener('error', onError);
      audio.pause();
      audio.src = '';
    }
    try {
      source?.disconnect();
    } catch {
      /* already gone */
    }
    try {
      gainNode?.disconnect();
    } catch {
      /* already gone */
    }
    audio = null;
    source = null;
    gainNode = null;
    onEnd = null;
    onError = null;
  }

  function scheduleNext() {
    if (!running) return;
    const gapMs = (gapMinSec + Math.random() * Math.max(0, gapMaxSec - gapMinSec)) * 1000;
    gapTimer = setTimeout(() => {
      gapTimer = null;
      playNext();
    }, gapMs);
  }

  function playNext() {
    if (!running) return;
    const track = pickNext();
    if (!track) return;
    currentTrack = track;
    const el = new Audio(track.url);
    el.preload = 'auto';
    el.loop = false;
    // Each <audio> element can only be wired once via createMediaElementSource,
    // so we spin up a fresh element + source per track and tear both down on
    // `ended`.
    const src = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    onEnd = () => {
      cleanupCurrent();
      scheduleNext();
    };
    onError = () => {
      // One bad track shouldn't stall the playlist — log, tear down, and
      // move on to the next entry after the usual gap.
      console.warn('[music] playback error for', track.url);
      cleanupCurrent();
      scheduleNext();
    };
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onError);
    audio = el;
    source = src;
    gainNode = g;
    void el.play().catch((err) => {
      console.warn('[music] play() rejected:', err);
      cleanupCurrent();
      scheduleNext();
    });
  }

  function start() {
    if (running) return;
    running = true;
    playNext();
  }

  function stop() {
    running = false;
    if (gapTimer) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
    cleanupCurrent();
    currentTrack = null;
  }

  function getCurrentTrack() {
    return currentTrack?.name ?? null;
  }

  return { start, stop, getCurrentTrack };
}
