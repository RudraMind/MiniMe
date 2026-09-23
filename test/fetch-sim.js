// Fetch harness. Drives PalState headlessly (no Electron) to check the dog's fetch
// loop: run to the thrown bone, pick it up, carry it back to the cursor, drop it,
// then sit and stare until it is thrown again. Run with `npm test`.
//
// Rule for adding cases: assert on state and on the bone's position, never on a
// timer. The loop is driven by arrival at a point, so waiting for a duration would
// pass or fail depending on walk speed.
const { PalState, STATES } = require('../state.js');

const BOUNDS = { minX: 0, maxX: 1400, minY: 39, maxY: 800 };
const TICK = 16;
let failures = 0;

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
}

function make(opts = {}) {
  const pal = new PalState({
    bounds: BOUNDS,
    houseDoor: { x: 1300, y: 60 },
    startX: 300, startY: 400,
    flourishes: { sit: 2, jump: 1 },
    character: 'dog',
    ...opts,
  });
  pal.setChair({ x: 700, y: 420 });
  pal.setDock(null);
  return pal;
}

// Advance `ms` of ticks, holding the system idle clock at zero so the boredom
// ladder never fires and steals the state under the test.
function run(pal, ms, onTick) {
  for (let t = 0; t < ms; t += TICK) {
    pal.setSystemIdleMs(0);
    pal.tick(TICK);
    if (onTick) onTick(pal, t);
  }
}

// Tick until the predicate holds or the budget runs out. Returns whether it held.
function until(pal, predicate, budgetMs = 20000) {
  for (let t = 0; t < budgetMs; t += TICK) {
    if (predicate(pal)) return true;
    pal.setSystemIdleMs(0);
    pal.tick(TICK);
  }
  return predicate(pal);
}

// A dog parked in one stage of the fetch loop, so each stage can be interrupted and
// checked independently.
function atState(target) {
  const pal = make();
  pal.updateCursor(200, 500, false);
  pal.throwBone({ x: 1000, y: 400 });
  if (target === STATES.FETCH_RUN) return pal;
  until(pal, (p) => p.state === target);
  return pal;
}

function main() {
  // 1. Throwing the bone starts the sprint.
  const pal = make();
  pal.throwBone({ x: 1000, y: 400 });
  check('throwing the bone starts the run', pal.state === STATES.FETCH_RUN, pal.state);

  // 2. He reaches the bone and takes a beat to pick it up.
  const reached = until(pal, (p) => p.state !== STATES.FETCH_RUN);
  check('the run ends at the bone', reached && Math.round(pal.x) === 1000 && Math.round(pal.y) === 400,
    `state=${pal.state} at ${Math.round(pal.x)},${Math.round(pal.y)}`);
  check('reaching the bone starts the pick-up beat', pal.state === STATES.FETCH_PICKUP, pal.state);

  // 3. The beat ends, he now has the bone, and he heads for the cursor.
  pal.updateCursor(200, 500, false);
  const carrying = until(pal, (p) => p.state !== STATES.FETCH_PICKUP, 2000);
  check('the pick-up beat ends in a carry', carrying && pal.state === STATES.FETCH_CARRY, pal.state);
  check('the bone is in his mouth while carrying', pal.boneCarried === true, String(pal.boneCarried));
  check('the carried bone travels with him', Math.round(pal.bone.x) === Math.round(pal.x),
    `bone ${Math.round(pal.bone.x)} vs dog ${Math.round(pal.x)}`);

  // 4. He arrives at the cursor, drops the bone there, and sits.
  const delivered = until(pal, (p) => p.state !== STATES.FETCH_CARRY);
  check('the carry ends at your cursor', delivered && Math.round(pal.x) === 200 && Math.round(pal.y) === 500,
    `at ${Math.round(pal.x)},${Math.round(pal.y)}`);
  check('arriving drops the bone and he sits', pal.state === STATES.FETCH_HOLD, pal.state);
  check('the bone is no longer in his mouth', pal.boneCarried === false, String(pal.boneCarried));
  check('the bone is left where he stands', Math.round(pal.bone.x) === 200 && Math.round(pal.bone.y) === 500,
    `bone at ${Math.round(pal.bone.x)},${Math.round(pal.bone.y)}`);

  // 5. If you never throw it again, he gives up and goes back to wandering.
  const gaveUp = until(pal, (p) => p.state !== STATES.FETCH_HOLD, 12000);
  check('he stops staring eventually', gaveUp && pal.state === STATES.IDLE, pal.state);
  check('the bone stays on the floor after he gives up',
    pal.bone !== null && Math.round(pal.bone.x) === 200, pal.bone && Math.round(pal.bone.x));

  // 6. Fetch is the dog's game. Everyone else just has a bone on the floor.
  const raj = make({ character: 'raj' });
  const before = raj.state;
  const started = raj.throwBone({ x: 1000, y: 400 });
  check('a non-dog character does not fetch', started === false && raj.state === before, raj.state);
  check('a non-dog character still records where the bone is',
    raj.bone !== null && raj.bone.x === 1000, raj.bone && raj.bone.x);

  // 7. Reminders outrank the game, from every stage of it. This is the whole point of
  // the app: a stretch nudge that vanishes because the dog was busy playing is a far
  // worse bug than a spoiled game.
  for (const target of [STATES.FETCH_RUN, STATES.FETCH_PICKUP, STATES.FETCH_CARRY, STATES.FETCH_HOLD]) {
    const d = atState(target);
    check(`reachable: ${target}`, d.state === target, d.state);
    const took = d.requestReminder('stretch');
    check(`a stretch reminder interrupts ${target}`, took === true && d.state === STATES.WALKING,
      `took=${took} state=${d.state}`);
    check(`the bone is left on the floor when ${target} is interrupted`,
      d.boneCarried === false && d.bone !== null, `carried=${d.boneCarried}`);
  }

  // 7b. Restoring a saved bone position on startup must not send him chasing it. Only
  // a throw starts a fetch.
  const restored = make();
  restored.placeBone({ x: 1200, y: 100 });
  check('placing the bone does not start a fetch', restored.state === STATES.IDLE, restored.state);
  check('placing the bone still records where it is',
    restored.bone !== null && restored.bone.x === 1200, restored.bone && restored.bone.x);

  // 8. The renderer draws the bone from the snapshot, so the snapshot has to carry it.
  const snapDog = atState(STATES.FETCH_CARRY);
  const snap = snapDog.serialize();
  check('the snapshot carries the bone position', snap.bone !== undefined && snap.bone !== null,
    JSON.stringify(snap.bone));
  check('the snapshot says whether the bone is in his mouth', snap.boneCarried === true,
    String(snap.boneCarried));

  // 9. A bone thrown off the edge of the screen must not walk him off it too.
  const far = make();
  far.updateCursor(200, 500, false);
  far.throwBone({ x: 99999, y: 99999 });
  let escaped = null;
  until(far, (p) => {
    if (p.x < BOUNDS.minX - 0.01 || p.x > BOUNDS.maxX + 0.01
      || p.y < BOUNDS.minY - 0.01 || p.y > BOUNDS.maxY + 0.01) escaped = `${p.x},${p.y}`;
    return escaped !== null || p.state === STATES.FETCH_HOLD;
  });
  check('a bone thrown off screen never walks him off screen', escaped === null, escaped);

  // 10. One time in five he stops short and makes you wait for it. Checked as a rate
  // over many runs rather than on one, because it is deliberately random.
  let teased = 0;
  const TRIALS = 200;
  for (let i = 0; i < TRIALS; i++) {
    const d = make();
    d.updateCursor(200, 500, false);
    d.throwBone({ x: 1000, y: 400 });
    until(d, (p) => p.state === STATES.FETCH_HOLD);
    if (d.teasedThisFetch) teased++;
  }
  const rate = teased / TRIALS;
  check('he teases you sometimes', teased > 0, `${teased}/${TRIALS}`);
  check('the tease rate is about one in five', rate > 0.08 && rate < 0.34, rate.toFixed(3));

  // 11. Every channel the renderer sends must be allowed by preload.js. It drops unknown
  // channels silently, with no error anywhere, so a missing entry looks exactly like a
  // feature that does nothing. That is how the bone first shipped undraggable: it moved
  // on screen, because the renderer repositions the element itself, and snapped back on
  // release because main never heard about the drag at all.
  const fs = require('fs');
  const path = require('path');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const allowed = new Set([...preload.matchAll(/'([a-z]+:[a-zA-Z]+)'/g)].map((m) => m[1]));
  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'chotu.js'), 'utf8');
  const sent = new Set();
  for (const m of rendererSrc.matchAll(/pixelpal\.send\(\s*'([a-z]+:[a-zA-Z]+)'/g)) sent.add(m[1]);
  // Template-literal channels, e.g. `${dragTarget}:drag`, with the targets enumerated.
  for (const m of rendererSrc.matchAll(/pixelpal\.send\(`\$\{(\w+)\}:(\w+)`/g)) {
    for (const target of ['pal', 'house', 'bone']) sent.add(`${target}:${m[2]}`);
  }
  const missing = [...sent].filter((c) => !allowed.has(c)).sort();
  check('every channel the renderer sends is allowed by preload', missing.length === 0,
    missing.join(', ') || `${sent.size} channels checked`);

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
