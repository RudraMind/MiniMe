import { ANIMATIONS } from './animations.js';
import { prefetchFrameSet } from './recolor.js';

const palEl = document.getElementById('pal');
const ringFill = document.getElementById('ringFill');
const countEl = document.getElementById('count');
const skipBtn = document.getElementById('skip');

const FRAME_BASE = '../assets/pal/';
const RING_CIRCUMFERENCE = 283;

let total = 10;
const drink = ANIMATIONS.drink;
let frameIndex = 0;
let frameSrcMap = Object.fromEntries(drink.frames.map((f) => [f, FRAME_BASE + f + '.png']));

window.pixelpal.invoke('config:get').then(async (cfg) => {
  frameSrcMap = await prefetchFrameSet(drink.frames, cfg.shirtColor, cfg.pantColor);
  palEl.src = frameSrcMap[drink.frames[frameIndex]];
});

setInterval(() => {
  frameIndex = (frameIndex + 1) % drink.frames.length;
  palEl.src = frameSrcMap[drink.frames[frameIndex]];
}, drink.ms);

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
