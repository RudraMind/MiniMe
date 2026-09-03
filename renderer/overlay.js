import { getCharacter, resolveAnimation, DEFAULT_CHARACTER } from './animations.js';
import { prefetchFrameSet } from './recolor.js';

const palEl = document.getElementById('pal');
const ringFill = document.getElementById('ringFill');
const countEl = document.getElementById('count');
const skipBtn = document.getElementById('skip');

const RING_CIRCUMFERENCE = 283;

let total = 10;
// The overlay shows whichever character is active, drinking.
let drink = resolveAnimation(DEFAULT_CHARACTER, 'drink');
let frameIndex = 0;
let frameSrcMap = {};
let cycleHandle = null;

function startCycle() {
  if (cycleHandle) clearInterval(cycleHandle);
  frameIndex = 0;
  const first = frameSrcMap[drink.frames[0]];
  if (first) palEl.src = first;
  // A single-frame drink pose needs no timer at all.
  if (drink.frames.length < 2) return;
  cycleHandle = setInterval(() => {
    frameIndex = (frameIndex + 1) % drink.frames.length;
    const src = frameSrcMap[drink.frames[frameIndex]];
    if (src) palEl.src = src;
  }, drink.ms);
}

window.pixelpal.invoke('config:get').then(async (cfg) => {
  const key = cfg && cfg.character ? cfg.character : DEFAULT_CHARACTER;
  const c = getCharacter(key);
  drink = resolveAnimation(key, 'drink');
  frameSrcMap = Object.fromEntries(drink.frames.map((f) => [f, c.dir + f + '.png']));
  startCycle();
  if (c.recolorable) {
    frameSrcMap = await prefetchFrameSet(drink.frames, cfg.shirtColor, cfg.pantColor, c.dir);
    startCycle();
  }
});

function dismiss(reason) {
  window.pixelpal.send('overlay:dismiss', { reason });
}

window.pixelpal.on('overlay:open', ({ seconds }) => {
  total = seconds;
  countEl.textContent = String(seconds);
  ringFill.style.strokeDashoffset = '0';
});

window.pixelpal.on('overlay:countdown', ({ remaining }) => {
  countEl.textContent = String(Math.max(remaining, 0));
  const frac = Math.max(remaining, 0) / total;
  ringFill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - frac));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismiss('esc');
});

skipBtn.addEventListener('click', () => dismiss('esc'));
