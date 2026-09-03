import { ANIMATIONS } from './animations.js';
import { prefetchFrameSet } from './recolor.js';

const palEl = document.getElementById('pal');
const houseEl = document.getElementById('house');
const houseImg = document.getElementById('houseImg');
const bubbleEl = document.getElementById('bubble');
const zzzEl = document.getElementById('zzz');

const FRAME_BASE = '../assets/pal/';
const HOUSE_BASE = '../assets/house/';
const PAL_W = 72;
const PAL_H = 72;
const HOUSE_W = 120;
const HOUSE_H = 120;

const ALL_FRAME_NAMES = [...new Set(Object.values(ANIMATIONS).flatMap((a) => a.frames))];
let frameSrcMap = Object.fromEntries(ALL_FRAME_NAMES.map((f) => [f, FRAME_BASE + f + '.png']));

// Preload house states so swapping closed/open/night never flickers.
for (const s of ['house_closed', 'house_open', 'house_night']) {
  const img = new Image();
  img.src = HOUSE_BASE + s + '.png';
}

async function applyColors(shirtKey, pantKey) {
  frameSrcMap = await prefetchFrameSet(ALL_FRAME_NAMES, shirtKey, pantKey);
}

window.pixelpal.invoke('config:get').then((cfg) => applyColors(cfg.shirtColor, cfg.pantColor));
window.pixelpal.on('config:update', (cfg) => applyColors(cfg.shirtColor, cfg.pantColor));

let currentAnim = null;
let frameIndex = 0;
let frameElapsed = 0;
let lastTs = performance.now();
let facing = 1;

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
  palEl.style.transform = `scaleX(${facing < 0 ? -1 : 1})`;
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

// --- hover / click-through -------------------------------------------------
let hovering = false;
function bboxContains(el, x, y) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function updateHover(e) {
  const inside = bboxContains(palEl, e.clientX, e.clientY) || bboxContains(houseEl, e.clientX, e.clientY);
  if (inside && !hovering) {
    hovering = true;
    window.pixelpal.send('hover:enter', {});
  } else if (!inside && hovering) {
    hovering = false;
    window.pixelpal.send('hover:leave', {});
  }
}

// --- dragging --------------------------------------------------------------
const DRAG_THRESHOLD_PX = 4;
let dragTarget = null; // 'pal' | 'house'
let dragStart = null;
let dragging = false;
let grabOffset = { x: 0, y: 0 };
let suppressNextClick = false;

function beginPointerDown(target, e) {
  if (e.button !== 0) return;
  const rect = (target === 'pal' ? palEl : houseEl).getBoundingClientRect();
  dragTarget = target;
  dragStart = { x: e.clientX, y: e.clientY };
  // Grab from wherever it was clicked so it doesn't jump to the cursor.
  grabOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  dragging = false;
  suppressNextClick = false;
}

palEl.addEventListener('mousedown', (e) => beginPointerDown('pal', e));
houseEl.addEventListener('mousedown', (e) => beginPointerDown('house', e));

let lastPointer = { x: 0, y: 0 };
let dragHeartbeat = null;
let lastDragPos = null;

document.addEventListener('mousemove', (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  if (dragTarget) {
    if (!dragging) {
      const moved = Math.abs(e.clientX - dragStart.x) > DRAG_THRESHOLD_PX
        || Math.abs(e.clientY - dragStart.y) > DRAG_THRESHOLD_PX;
      if (moved) {
        dragging = true;
        if (dragTarget === 'pal') window.pixelpal.send('pal:dragstart', {});
        // Heartbeat so main's watchdog can tell "held still" from "renderer
        // stopped talking" — without it, holding still for 2s drops the pal.
        clearInterval(dragHeartbeat);
        dragHeartbeat = setInterval(() => {
          if (!dragging || !lastDragPos) return;
          window.pixelpal.send(dragTarget === 'pal' ? 'pal:drag' : 'house:drag', lastDragPos);
        }, 400);
      }
    }
    if (dragging) {
      const x = e.clientX - grabOffset.x;
      const y = e.clientY - grabOffset.y;
      lastDragPos = { x, y };
      if (dragTarget === 'pal') {
        window.pixelpal.send('pal:drag', { x, y });
      } else {
        // Move the house immediately for responsiveness; main persists on drop.
        houseEl.style.left = `${x}px`;
        houseEl.style.top = `${y}px`;
        window.pixelpal.send('house:drag', { x, y });
      }
      return; // don't let hover tracking make the window click-through mid-drag
    }
  }
  updateHover(e);
});

function finishDrag() {
  clearInterval(dragHeartbeat);
  dragHeartbeat = null;
  if (dragging) {
    window.pixelpal.send(dragTarget === 'pal' ? 'pal:dragend' : 'house:dragend', {});
    // 'mouseup' fires before 'click', so flag it here or the drop would also
    // register as a click and trigger a wave.
    suppressNextClick = true;
  }
  dragging = false;
  dragTarget = null;
  dragStart = null;
  lastDragPos = null;
  // Hover tracking is skipped during a drag, so `hovering` can still be true
  // with the cursor nowhere near the pal. The window covers the whole screen,
  // so leaving it non-click-through would swallow every click until the next
  // mousemove. Re-evaluate immediately using the last known cursor position.
  updateHover({ clientX: lastPointer.x, clientY: lastPointer.y });
}

document.addEventListener('mouseup', finishDrag);
// Cursor left the window mid-drag: put it down rather than leaving it stuck.
document.addEventListener('mouseleave', finishDrag);

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const target = bboxContains(houseEl, e.clientX, e.clientY) ? 'house' : 'pal';
  window.pixelpal.send('pal:click', { button: 'right', target });
});

palEl.addEventListener('click', () => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  window.pixelpal.send('pal:click', { button: 'left', target: 'pal' });
});

// --- state from main -------------------------------------------------------
window.pixelpal.on('pal:state', (s) => {
  palEl.style.left = `${s.x}px`;
  palEl.style.top = `${s.y}px`;
  facing = s.facing;
  setAnimation(s.animation || 'idle');

  // Don't fight the user's cursor while they're dragging the house.
  if (!(dragging && dragTarget === 'house')) {
    houseEl.style.left = `${s.houseX}px`;
    houseEl.style.top = `${s.houseY}px`;
  }

  houseImg.src = `${HOUSE_BASE}house_${s.houseState}.png`;
  zzzEl.classList.toggle('hidden', s.houseState !== 'night');

  if (s.bubbleText) {
    bubbleEl.textContent = s.bubbleText;
    bubbleEl.classList.remove('hidden');
    // Centered above the pal, kept inside the window.
    const bw = bubbleEl.offsetWidth || 120;
    const left = Math.min(Math.max(s.x + PAL_W / 2 - bw / 2, 4), window.innerWidth - bw - 4);
    bubbleEl.style.left = `${left}px`;
    bubbleEl.style.top = `${Math.max(s.y - 44, 4)}px`;
  } else {
    bubbleEl.classList.add('hidden');
  }

  palEl.classList.toggle('hidden', s.state === 'SLEEPING');
});
