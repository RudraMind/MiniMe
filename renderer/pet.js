import { ANIMATIONS } from './animations.js';
import { prefetchFrameSet } from './recolor.js';

const palEl = document.getElementById('pal');
const houseEl = document.getElementById('house');
const bubbleEl = document.getElementById('bubble');
const zzzEl = document.getElementById('zzz');

const FRAME_BASE = '../assets/pal/';
const ALL_FRAME_NAMES = [...new Set(Object.values(ANIMATIONS).flatMap((a) => a.frames))];

let frameSrcMap = Object.fromEntries(ALL_FRAME_NAMES.map((f) => [f, FRAME_BASE + f + '.png']));

async function applyColors(shirtKey, pantKey) {
  frameSrcMap = await prefetchFrameSet(ALL_FRAME_NAMES, shirtKey, pantKey);
}

window.pixelpal.invoke('config:get').then((cfg) => {
  applyColors(cfg.shirtColor, cfg.pantColor);
});
window.pixelpal.on('config:update', (cfg) => {
  applyColors(cfg.shirtColor, cfg.pantColor);
});

let currentAnim = null;
let frameIndex = 0;
let frameElapsed = 0;
let lastTs = performance.now();
let facing = 1;
let orientation = 'horizontal';

function setAnimation(name) {
  if (currentAnim === name) return;
  currentAnim = name;
  frameIndex = 0;
  frameElapsed = 0;
}

function renderLoop(ts) {
  const dt = ts - lastTs;
  lastTs = ts;
  const anim = ANIMATIONS[currentAnim] || ANIMATIONS.idle;
  frameElapsed += dt;
  if (frameElapsed >= anim.ms) {
    frameElapsed = 0;
    if (frameIndex < anim.frames.length - 1) {
      frameIndex += 1;
    } else if (anim.loop) {
      frameIndex = 0;
    }
  }
  const frame = anim.frames[Math.min(frameIndex, anim.frames.length - 1)];
  palEl.src = frameSrcMap[frame] || FRAME_BASE + frame + '.png';
  // No up/down-facing art exists — only mirror left/right in horizontal mode.
  palEl.style.transform = orientation === 'vertical' ? 'none' : `scaleX(${facing < 0 ? -1 : 1})`;
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

let hovering = false;
function bboxContains(el, x, y) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

document.addEventListener('mousemove', (e) => {
  const inside = bboxContains(palEl, e.clientX, e.clientY) || bboxContains(houseEl, e.clientX, e.clientY);
  if (inside && !hovering) {
    hovering = true;
    window.pixelpal.send('hover:enter', {});
  } else if (!inside && hovering) {
    hovering = false;
    window.pixelpal.send('hover:leave', {});
  }
});

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const target = bboxContains(houseEl, e.clientX, e.clientY) ? 'house' : 'pal';
  window.pixelpal.send('pal:click', { button: 'right', target });
});

palEl.addEventListener('click', () => {
  window.pixelpal.send('pal:click', { button: 'left', target: 'pal' });
});

let bubbleTimeout = null;
window.pixelpal.on('pal:state', (s) => {
  if (s.orientation && s.orientation !== orientation) {
    orientation = s.orientation;
    document.body.classList.toggle('vertical', orientation === 'vertical');
  }

  if (orientation === 'vertical') {
    palEl.style.top = `${s.x}px`;
    palEl.style.left = '';
  } else {
    palEl.style.left = `${s.x}px`;
    palEl.style.top = '';
  }
  facing = s.facing;
  setAnimation(s.animation || 'idle');

  if (s.bubbleText) {
    bubbleEl.textContent = s.bubbleText;
    bubbleEl.classList.remove('hidden');
    if (orientation === 'vertical') {
      bubbleEl.style.top = `${s.x - 56}px`;
      bubbleEl.style.left = '';
    } else {
      bubbleEl.style.left = `${s.x + 48}px`;
      bubbleEl.style.top = '';
    }
  } else {
    bubbleEl.classList.add('hidden');
  }

  houseEl.classList.remove('state-closed', 'state-open', 'state-night');
  houseEl.classList.add(`state-${s.houseState}`);
  if (s.houseState === 'night') {
    zzzEl.classList.remove('hidden');
  } else {
    zzzEl.classList.add('hidden');
  }

  if (s.state === 'SLEEPING') {
    palEl.classList.add('hidden');
  } else {
    palEl.classList.remove('hidden');
  }
});
