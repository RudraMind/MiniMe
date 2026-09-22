// "Play" menu harness: every rung, asked for directly, does what the ladder would
// do on its own — and behaves the same way afterwards. 29 assertions. Run with
// `npm test`.
//
// The mouse is held active throughout on purpose. That is what actually happens
// when someone clicks a menu item to watch it, and it is the case that broke
// twice: the click's own mouse movement cancelling the thing it just asked for.
const { PalState, BOREDOM_RUNGS } = require('../state.js');

const B = { minX: 0, maxX: 1728, minY: 39, maxY: 1097 };
const CHAIR = { x: 800, y: 500 };
const TICK = 16;
let fail = 0;
const ck = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!ok) fail++; };

function mk(dockInfo, opts = {}) {
  const p = new PalState({
    bounds: B, houseDoor: { x: 1600, y: 60 }, startX: 300, startY: 900,
    flourishes: { sit: 2, jump: 1, glasses: 1 }, ...opts,
  });
  p.setChair(CHAIR);
  p.setDock(dockInfo);
  p.setSystemIdleMs(0);
  return p;
}
// Ticks with the machine "in use" the whole time — the hard case, because that
// is what actually happens when someone clicks a menu item to watch it.
function busy(p, ms) { for (let t = 0; t < ms; t += TICK) { p.setSystemIdleMs(0); p.tick(TICK); } }
function quiet(p, ms, idle) { for (let t = 0; t < ms; t += TICK) { p.setSystemIdleMs(idle + t); p.tick(TICK); } }
function until(p, pred, cap) { for (let t = 0; t < cap; t += TICK) { p.setSystemIdleMs(0); p.tick(TICK); if (pred(p)) return t; } return -1; }

const DOCK = { edge: 'left', hidden: false, tileSize: 41 };

// --- the menu offers all four ----------------------------------------------
{
  const p = mk(DOCK);
  ck('menu lists 4 rungs', BOREDOM_RUNGS.length === 4, BOREDOM_RUNGS.map((r) => r.key).join(','));
  ck('all four playable when idle', BOREDOM_RUNGS.every((r) => p.canPlayRung(r.key)));
  ck('unknown rung refused', p.canPlayRung('nap') === false && p.playRung('nap') === false);
}

// --- fidget ----------------------------------------------------------------
{
  const p = mk(DOCK);
  ck('fidget accepted', p.playRung('fidget') === true);
  // Something visible must happen promptly, not up to 20s later.
  const t = until(p, (x) => x.animation !== 'idle' || x.state === 'WALKING', 3000);
  ck('fidget does something within 3s', t >= 0, `after ${(t / 1000).toFixed(1)}s -> ${p.state}/${p.animation}`);
  ck('fidget sets rung 1', p.bored === 1, `rung=${p.bored}`);
}

// --- give up on me (sulk) --------------------------------------------------
{
  const p = mk(DOCK);
  p.playRung('sulk');
  const t = until(p, (x) => x.state === 'SULKING', 30000);
  ck('sulk walks to the chair and sits', t >= 0 && Math.abs(p.x - CHAIR.x) < 2 && Math.abs(p.y - CHAIR.y) < 2,
    `after ${(t / 1000).toFixed(1)}s at (${p.x.toFixed(0)},${p.y.toFixed(0)}) anim=${p.animation}`);
}

// --- doze ------------------------------------------------------------------
{
  const p = mk(DOCK);
  p.playRung('doze');
  const t = until(p, (x) => x.state === 'DOZING', 30000);
  ck('doze goes to the chair first, then sleeps', t >= 0 && Math.abs(p.x - CHAIR.x) < 2,
    `after ${(t / 1000).toFixed(1)}s at (${p.x.toFixed(0)},${p.y.toFixed(0)}) anim=${p.animation} "${p.bubbleText}"`);
  ck('doze shows zzz', p.bubbleText === 'zzz', String(p.bubbleText));
  ck('doze sets rung 4', p.bored === 4, `rung=${p.bored}`);
}
// Already sitting in the chair: dozes on the spot, no pointless walk.
{
  const p = mk(DOCK, { startX: CHAIR.x, startY: CHAIR.y });
  p.playRung('doze');
  ck('doze in the chair starts immediately', p.state === 'DOZING', p.state);
}

// --- dock trip -------------------------------------------------------------
{
  const p = mk(DOCK);
  p.playRung('dock');
  const t = until(p, (x) => x.state === 'PATROLLING', 40000);
  ck('dock trip patrols', t >= 0 && p.animation === 'inspect', `after ${(t / 1000).toFixed(1)}s ${p.state}/${p.animation}`);
  busy(p, 4 * 60 * 1000);
  ck('dock trip ends in normal wandering', ['IDLE', 'WALKING'].includes(p.state) && p.bored === 0,
    `${p.state} rung=${p.bored}`);
}

// --- the grace period, and what happens after it ---------------------------
{
  // The click itself must not cancel the thing it asked for.
  const p = mk(DOCK);
  p.playRung('doze');
  busy(p, 3000);
  ck('grace: an active mouse does not cancel it straight away',
    p.state === 'DOZING' || p.state === 'WALKING', p.state);
}
{
  // After the grace, it behaves exactly like the real rung: input startles.
  const p = mk(DOCK, { startX: CHAIR.x, startY: CHAIR.y });
  p.playRung('doze');
  busy(p, 8000);
  ck('after the grace, a busy mouse wakes him', p.bored === 0 && p.state !== 'DOZING',
    `${p.state}/${p.animation} rung=${p.bored}`);
}
{
  // Left alone after asking, he keeps escalating from the rung you picked.
  const p = mk(DOCK);
  p.playRung('sulk');
  until(p, (x) => x.state === 'SULKING', 30000);
  quiet(p, 30 * 1000, 5.1 * 60 * 1000);
  ck('left alone after a played rung, he escalates onward',
    p.bored === 3 && p.state !== 'SULKING', `rung=${p.bored} ${p.state}`);
}

// --- clicking him is the way out -------------------------------------------
{
  const p = mk(DOCK, { startX: CHAIR.x, startY: CHAIR.y });
  p.playRung('doze');
  ck('dozing on request', p.state === 'DOZING');
  const waved = p.wave();
  ck('clicking him ends it and he waves', waved && p.animation === 'wave' && p.bored === 0 && !p.bubbleText,
    `${p.state}/${p.animation} rung=${p.bored} "${p.bubbleText}"`);
}
{
  const p = mk({ edge: 'left', hidden: true, tileSize: 41 });
  p.playRung('dock');
  until(p, (x) => x.state === 'ASKING_CURSOR', 40000);
  ck('mid-ask, clicking him cancels the trip', p.wave() && p.bored === 0 && !p.bubbleText, `${p.state}/${p.animation}`);
}

// --- everything still outranks it -----------------------------------------
{
  const p = mk(DOCK, { startX: CHAIR.x, startY: CHAIR.y });
  p.playRung('doze');
  const acc = p.requestReminder('stretch');
  let seen = false;
  for (let t = 0; t < 40000; t += TICK) { p.setSystemIdleMs(0); p.tick(TICK); if (p.state === 'REMINDING') seen = true; }
  ck('a reminder interrupts a played doze', acc && seen, `accepted=${acc} reminded=${seen}`);
}
{
  const p = mk(DOCK);
  p.startWork(CHAIR);
  ck('nothing playable during a focus session', BOREDOM_RUNGS.every((r) => !p.canPlayRung(r.key)));
}
{
  const p = mk(DOCK);
  p.requestSleep();
  ck('nothing playable while going to bed', BOREDOM_RUNGS.every((r) => !p.canPlayRung(r.key)));
}
{
  const p = mk(null);
  ck('no Dock: dock rung not playable, the other three are',
    !p.canPlayRung('dock') && p.canPlayRung('fidget') && p.canPlayRung('sulk') && p.canPlayRung('doze'));
}
{
  const p = mk(DOCK, { dockTrip: false });
  ck('dockTrip off: dock rung not playable', !p.canPlayRung('dock'));
}
{
  // The whole ladder switched off must not disable asking for it by hand.
  const p = mk(DOCK, { boredomLadder: false, startX: CHAIR.x, startY: CHAIR.y });
  ck('ladder off: still playable on request', p.playRung('doze') === true && p.state === 'DOZING', p.state);
  quiet(p, 30 * 1000, 60 * 1000);
  ck('ladder off: he holds the pose while left alone', p.state === 'DOZING', p.state);
  busy(p, 3000);
  ck('ladder off: input still gets him out of it', p.state !== 'DOZING', `${p.state}/${p.animation}`);
}
{
  const p = mk(DOCK, { boredomLadder: false });
  quiet(p, 5000, 20 * 60 * 1000);
  ck('ladder off: nothing happens unasked', p.bored === 0 && !['SULKING', 'DOZING', 'PATROLLING'].includes(p.state), p.state);
}
{
  const p = mk(DOCK);
  p.beginDrag();
  ck('nothing playable while being dragged', BOREDOM_RUNGS.every((r) => !p.canPlayRung(r.key)));
}

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall play-menu checks passed');
process.exit(fail ? 1 : 0);
