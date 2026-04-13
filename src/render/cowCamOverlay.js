/**
 * Camcorder-style DOM overlay for first-person mode. Draws a dark frame
 * around the viewport plus a REC indicator and "COW CAM" title with the
 * active cow's name. Pure DOM — no three.js involvement so it sits crisply
 * above the canvas at any resolution.
 */

const OVERLAY_ID = 'cow-cam-overlay';
const STYLE_ID = 'cow-cam-overlay-style';

const CSS = `
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  display: none;
  z-index: 10;
  font-family: "Courier New", monospace;
  color: #fff;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.85), 0 0 2px rgba(0, 0, 0, 0.85);
}
#${OVERLAY_ID}.on { display: block; }

/* Soft vignette so the camcorder feel reads even on bright scenes. */
#${OVERLAY_ID}::before {
  content: "";
  position: absolute;
  inset: 0;
  box-shadow: inset 0 0 180px 40px rgba(0, 0, 0, 0.55);
  pointer-events: none;
}

/* Corner brackets — four little L's, one per corner. */
.cc-corner {
  position: absolute;
  width: 42px;
  height: 42px;
  border-color: rgba(255, 255, 255, 0.85);
  border-style: solid;
}
.cc-corner.tl { top: 18px; left: 18px; border-width: 3px 0 0 3px; }
.cc-corner.tr { top: 18px; right: 18px; border-width: 3px 3px 0 0; }
.cc-corner.bl { bottom: 18px; left: 18px; border-width: 0 0 3px 3px; }
.cc-corner.br { bottom: 18px; right: 18px; border-width: 0 3px 3px 0; }

.cc-rec {
  position: absolute;
  top: 24px;
  left: 74px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: bold;
  letter-spacing: 0.12em;
  font-size: 18px;
}
.cc-rec-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ff2a2a;
  box-shadow: 0 0 10px #ff2a2a;
  animation: cc-blink 1.1s ease-in-out infinite;
}
@keyframes cc-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.15; }
}

.cc-title {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 24px;
  font-weight: bold;
  letter-spacing: 0.3em;
  text-align: center;
}
.cc-subtitle {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 16px;
  letter-spacing: 0.18em;
  text-align: center;
  opacity: 0.9;
}

.cc-mode {
  position: absolute;
  top: 24px;
  right: 74px;
  font-size: 14px;
  letter-spacing: 0.16em;
  font-weight: bold;
  opacity: 0.9;
}
.cc-mode.drafted {
  color: #ffd24d;
  text-shadow: 0 0 8px rgba(255, 180, 0, 0.65), 0 0 2px rgba(0, 0, 0, 0.9);
}

.cc-hints {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  letter-spacing: 0.14em;
  opacity: 0.75;
  text-align: center;
}
`;

export function createCowCamOverlay() {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const existing = /** @type {HTMLDivElement | null} */ (document.getElementById(OVERLAY_ID));
  /** @type {HTMLDivElement} */
  let root;
  if (existing) {
    root = existing;
  } else {
    root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.innerHTML = `
      <div class="cc-corner tl"></div>
      <div class="cc-corner tr"></div>
      <div class="cc-corner bl"></div>
      <div class="cc-corner br"></div>
      <div class="cc-rec"><span class="cc-rec-dot"></span>REC</div>
      <div class="cc-mode"></div>
      <div class="cc-title">COW CAM</div>
      <div class="cc-subtitle"></div>
      <div class="cc-hints">Q / E cycle  ·  R draft  ·  H exit</div>
    `;
    document.body.appendChild(root);
  }

  const subtitle = /** @type {HTMLElement} */ (root.querySelector('.cc-subtitle'));
  const modeEl = /** @type {HTMLElement} */ (root.querySelector('.cc-mode'));
  const hints = /** @type {HTMLElement} */ (root.querySelector('.cc-hints'));

  let lastName = '';
  let lastMode = '';
  let lastHints = '';

  /**
   * @param {{ active: boolean, cowId: number | null }} fp
   * @param {import('../ecs/world.js').World} world
   */
  function update(fp, world) {
    if (!fp.active) {
      if (root.classList.contains('on')) root.classList.remove('on');
      return;
    }
    if (!root.classList.contains('on')) root.classList.add('on');

    let name = '';
    let drafted = false;
    if (fp.cowId !== null) {
      const brain = world.get(fp.cowId, 'Brain');
      const cow = world.get(fp.cowId, 'Cow');
      name = brain?.name ?? `cow#${fp.cowId}`;
      drafted = cow?.drafted === true;
    }
    if (name !== lastName) {
      subtitle.textContent = name;
      lastName = name;
    }

    const modeLabel = drafted ? 'DRAFTED' : 'FREE';
    if (modeLabel !== lastMode) {
      modeEl.textContent = modeLabel;
      modeEl.classList.toggle('drafted', drafted);
      lastMode = modeLabel;
    }

    const hintText = drafted
      ? 'WASD move  ·  mouse look  ·  R release  ·  Q/E cycle  ·  H exit'
      : 'Q / E cycle  ·  R draft (take control)  ·  H exit';
    if (hintText !== lastHints) {
      hints.textContent = hintText;
      lastHints = hintText;
    }
  }

  function dispose() {
    root.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  return { update, dispose };
}
