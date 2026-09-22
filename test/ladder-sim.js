// Boredom-ladder harness. Drives PalState headlessly (no Electron) by feeding it
// a fake system-idle clock, so the seams can be checked without sitting still for
// 15 minutes. 30 assertions. Run with `npm test`.
//
// Rule for adding cases: wait for a STATE, never sleep for a duration. Every
// false failure while this was written came from sampling at 45s, long after the
// whole ~22s Dock patrol had finished, and finding him back in his chair.
const { PalState } = require('../state.js');

const BOUNDS = { minX: 0, maxX: 1400, minY: 39, maxY: 800 };
const TICK = 16;
let failures = 0;

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
}

function make(dockInfo, opts = {}) {
  const pal = new PalState({
    bounds: BOUNDS,
    houseDoor: { x: 1300, y: 60 },
    startX: 300, startY: 400,
    flourishes: { sit: 2, jump: 1 },
    ...opts,
  });
  pal.setChair({ x: 700, y: 420 });
  pal.setDock(dockInfo);
  return pal;
}

// Advance `ms` of ticks while holding the idle clock at `idleMs` (+elapsed).
function run(pal, ms, idleMs, onTick) {
  for (let t = 0; t < ms; t += TICK) {
    pal.setSystemIdleMs(idleMs + t);
    pal.tick(TICK);
    if (onTick) onTick(pal, t);
  }
}

function inBounds(pal) {
  return pal.x >= BOUNDS.minX - 0.01 && pal.x <= BOUNDS.maxX + 0.01
    && pal.y >= BOUNDS.minY - 0.01 && pal.y <= BOUNDS.maxY + 0.01;
}

// --- 1. rungs fire in order ------------------------------------------------
{
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 });
  const seen = [];
  const record = (p) => { if (seen[seen.length - 1] !== p.bored) seen.push(p.bored); };
  run(pal, 1000, 0, record);            // attentive
  run(pal, 1000, 31 * 1000, record);    // rung 1
  run(pal, 1000, 2.1 * 60 * 1000, record);
  run(pal, 1000, 5.1 * 60 * 1000, record);
  run(pal, 1000, 15.1 * 60 * 1000, record);
  check('1 rungs fire in order, none skipped', seen.join(',') === '0,1,2,3,4', seen.join(','));
  check('1 final rung dozes', pal.state === 'DOZING' && pal.animation === 'doze', `${pal.state}/${pal.animation}`);
  check('1 doze shows a zzz bubble', pal.bubbleText === 'zzz', String(pal.bubbleText));
}

// --- 2. a reminder during the Dock trip still arrives -----------------------
for (const phase of ['walking-to-dock', 'patrolling']) {
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 });
  run(pal, 300, 5.1 * 60 * 1000);
  if (phase === 'patrolling') run(pal, 8 * 1000, 5.1 * 60 * 1000);
  const stateBefore = pal.state;
  const accepted = pal.requestReminder('stretch');
  const rungAfter = pal.bored;
  // The reminder is delivered on arrival, so watch for it rather than sampling.
  let reminded = false;
  run(pal, 30 * 1000, 5.2 * 60 * 1000, (p) => { if (p.state === 'REMINDING') reminded = true; });
  check(`2 reminder interrupts ${phase} (${stateBefore})`,
    accepted && reminded && rungAfter === 0,
    `accepted=${accepted} reminded=${reminded} rung=${rungAfter}`);
}

// --- 3. focus session mid-ladder cancels it ---------------------------------
{
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 });
  run(pal, 60 * 1000, 5.1 * 60 * 1000); // mid dock trip
  pal.startWork({ x: 700, y: 420 });
  run(pal, 60 * 1000, 6 * 60 * 1000);   // still ignored: ladder must stay off
  check('3 focus session cancels the ladder and sits at the work spot',
    pal.state === 'WORKING' && pal.bored === 0 && Math.abs(pal.x - 700) < 2,
    `${pal.state} rung=${pal.bored} x=${pal.x.toFixed(1)}`);
}

// --- 4. input at each rung returns him to normal ----------------------------
for (const [label, idle] of [['fidget', 31e3], ['sulk', 126e3], ['dock', 306e3], ['doze', 906e3]]) {
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 });
  run(pal, label === 'dock' ? 8 * 1000 : 2000, idle);
  const during = pal.state;
  run(pal, 2000, 0); // you touched something
  const startled = pal.animation === 'startle' || pal.animation === 'idle';
  check(`4 input at ${label} (${during}) returns to normal`,
    pal.bored === 0 && ['IDLE', 'WALKING'].includes(pal.state) && startled && inBounds(pal),
    `${pal.state}/${pal.animation} rung=${pal.bored}`);
}

// --- 5. each Dock edge gives a sane patrol span -----------------------------
for (const edge of ['left', 'right', 'bottom']) {
  const pal = make({ edge, hidden: false, tileSize: 48 });
  // Walk-to-the-edge time depends on the edge (he starts near the left), so
  // sample as soon as the patrol starts rather than at a fixed time.
  for (let t = 0; t < 30 * 1000 && pal.state !== 'PATROLLING'; t += TICK) {
    pal.setSystemIdleMs(5.1 * 60 * 1000 + t);
    pal.tick(TICK);
  }
  const poseOk = edge === 'bottom' ? pal.animation === 'walk' : pal.animation === 'inspect';
  const onEdge = edge === 'bottom'
    ? Math.abs(pal.y - BOUNDS.maxY) < 1
    : Math.abs(pal.x - (edge === 'left' ? BOUNDS.minX : BOUNDS.maxX)) < 1;
  check(`5 ${edge} Dock: patrols the edge with the right pose`,
    pal.state === 'PATROLLING' && poseOk && onEdge && inBounds(pal),
    `${pal.state}/${pal.animation} x=${pal.x.toFixed(0)} y=${pal.y.toFixed(0)}`);
  // Vertical patrol must face the Dock and never flip.
  if (edge !== 'bottom') {
    const want = edge === 'right' ? 1 : -1;
    check(`5 ${edge} Dock: faces the Dock`, pal.facing === want, `facing=${pal.facing}`);
  }
  // And it must finish: 2-3 passes then back to the chair.
  run(pal, 5 * 60 * 1000, 5.1 * 60 * 1000);
  check(`5 ${edge} Dock: returns to the chair and sits`,
    pal.state === 'SULKING' && Math.abs(pal.x - 700) < 2 && Math.abs(pal.y - 420) < 2,
    `${pal.state} x=${pal.x.toFixed(0)} y=${pal.y.toFixed(0)}`);
}

// --- 6. pinning the Dock mid-patrol (work area shrinks) --------------------
{
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 });
  run(pal, 8 * 1000, 5.1 * 60 * 1000);
  const wasPatrolling = pal.state === 'PATROLLING';
  // Pinning a left Dock removes its strip from the work area.
  const pinned = { minX: 80, maxX: 1400, minY: 39, maxY: 800 };
  pal.setBounds(pinned, { x: 1300, y: 60 });
  run(pal, 5 * 60 * 1000, 5.2 * 60 * 1000);
  const ok = pal.x >= pinned.minX - 0.01 && pal.x <= pinned.maxX + 0.01
    && ['PATROLLING', 'SULKING', 'WALKING'].includes(pal.state);
  check('6 pinning the Dock mid-patrol keeps him on-screen and unstuck',
    wasPatrolling && ok, `${pal.state} x=${pal.x.toFixed(0)}`);
}

// --- 6b. the Dock disappears entirely mid-patrol ---------------------------
{
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 });
  run(pal, 8 * 1000, 5.1 * 60 * 1000);
  pal.setDock(null);
  // A display so small there is no span left to patrol.
  pal.setBounds({ minX: 0, maxX: 40, minY: 0, maxY: 40 }, { x: 20, y: 20 });
  run(pal, 60 * 1000, 5.2 * 60 * 1000);
  check('6b losing the Dock mid-patrol sends him home instead of walking nowhere',
    pal.state !== 'PATROLLING', pal.state);
}

// --- 7. no Dock at all (non-macOS) -----------------------------------------
{
  const pal = make(null);
  run(pal, 2000, 5.1 * 60 * 1000);
  const rungAfterDock = pal.bored;
  const stateAfterDock = pal.state;
  run(pal, 2000, 15.1 * 60 * 1000);
  check('7 no Dock: rung 3 falls through to a sulk, not an error',
    rungAfterDock === 3 && stateAfterDock === 'WALKING',
    `rung=${rungAfterDock} state=${stateAfterDock}`);
  check('7 no Dock: still reaches the doze rung', pal.bored === 4 && pal.state === 'DOZING',
    `rung=${pal.bored} ${pal.state}`);
}

// --- 8. hidden Dock: he asks, and gives up if nobody comes ------------------
{
  const pal = make({ edge: 'left', hidden: true, tileSize: 48 });
  run(pal, 8 * 1000, 5.1 * 60 * 1000);
  check('8 hidden Dock: asks for the cursor',
    pal.state === 'ASKING_CURSOR' && pal.animation === 'ask' && /mouse/.test(pal.bubbleText || ''),
    `${pal.state}/${pal.animation} "${pal.bubbleText}"`);
  pal.setCursorAtDock(true);
  run(pal, 100, 5.1 * 60 * 1000);
  check('8 cursor arrives: starts patrolling and drops the bubble',
    pal.state === 'PATROLLING' && !pal.bubbleText, `${pal.state} "${pal.bubbleText}"`);
}
{
  const pal = make({ edge: 'left', hidden: true, tileSize: 48 });
  run(pal, 8 * 1000, 5.1 * 60 * 1000);
  run(pal, 21 * 1000, 5.2 * 60 * 1000); // nobody comes; ask window is 20s
  check('8 nobody comes: walks back to the chair, bubble cleared',
    pal.state !== 'ASKING_CURSOR' && !pal.bubbleText, `${pal.state} "${pal.bubbleText}"`);
}

// --- 9. the feature switch ------------------------------------------------
{
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 }, { boredomLadder: false });
  run(pal, 5000, 16 * 60 * 1000);
  check('9 boredomLadder off: nothing happens', pal.bored === 0 && !['SULKING', 'DOZING', 'PATROLLING'].includes(pal.state), `${pal.state} rung=${pal.bored}`);
}
{
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 }, { dockTrip: false });
  run(pal, 2000, 5.1 * 60 * 1000);
  check('9 dockTrip off: rung 3 declines, other rungs still work',
    pal.bored === 3 && pal.state !== 'PATROLLING', `${pal.state} rung=${pal.bored}`);
}
{
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 });
  run(pal, 8 * 1000, 5.1 * 60 * 1000);
  pal.setBoredomEnabled(false);
  run(pal, 1000, 6 * 60 * 1000);
  check('9 switching it off mid-patrol puts him back to normal',
    pal.bored === 0 && ['IDLE', 'WALKING'].includes(pal.state), `${pal.state} rung=${pal.bored}`);
}

// --- 10. sleep and drag both outrank it ------------------------------------
{
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 });
  run(pal, 5000, 15.1 * 60 * 1000);
  const dozing = pal.state === 'DOZING';
  pal.requestSleep();
  run(pal, 2000, 16 * 60 * 1000);
  check('10 sending him to bed while dozing works',
    dozing && ['GOING_HOME', 'ENTERING_HOUSE', 'SLEEPING'].includes(pal.state) && pal.bored === 0,
    `${pal.state} rung=${pal.bored}`);
}
{
  const pal = make({ edge: 'left', hidden: false, tileSize: 48 });
  run(pal, 8 * 1000, 5.1 * 60 * 1000);
  const wasPatrolling = pal.state === 'PATROLLING';
  pal.beginDrag();
  pal.dragTo(200, 200);
  pal.endDrag();
  run(pal, 2000, 0);
  check('10 picking him up mid-patrol drops the ladder',
    wasPatrolling && pal.bored === 0 && pal.state === 'DRAGGED', `${pal.state} rung=${pal.bored}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
