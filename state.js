'use strict';
const { EventEmitter } = require('events');

const STATES = Object.freeze({
  IDLE: 'IDLE',
  WALKING: 'WALKING',
  REMINDING: 'REMINDING',
  GOING_HOME: 'GOING_HOME',
  ENTERING_HOUSE: 'ENTERING_HOUSE',
  SLEEPING: 'SLEEPING',
  WAKING: 'WAKING',
  EXITING_HOUSE: 'EXITING_HOUSE',
  FOLLOWING: 'FOLLOWING',
  RESTING: 'RESTING',
  DRAGGED: 'DRAGGED',
  WORKING: 'WORKING', // sitting at the work spot during a focus session
  BREAK: 'BREAK',     // stretching between focus sessions
  PLAYING: 'PLAYING', // bouncing around a dropped toy (the dog's idle game)
  // Boredom ladder, in the order it escalates. See BOREDOM_RUNGS.
  SULKING: 'SULKING',             // sat down in his chair, given up on you
  ASKING_CURSOR: 'ASKING_CURSOR', // at a hidden Dock, asking for your mouse
  PATROLLING: 'PATROLLING',       // pacing the length of the Dock
  DOZING: 'DOZING',               // asleep where he sat
});

const HOUSE = Object.freeze({ CLOSED: 'closed', OPEN: 'open', NIGHT: 'night' });

// walkSpeed is calibrated as "px per REFERENCE_TICK_MS", not px/ms directly —
// scaling by raw dtMs (16ms ticks) made the pal cover ~1400px/sec (a blink-
// and-you-miss-it dash instead of a walk).
const REFERENCE_TICK_MS = 16;

// Follow-cursor tuning.
const FOLLOW_DEADZONE_PX = 12;
const FOLLOW_SPEED_FACTOR = 0.7; // "walks slowly" toward the cursor

// How long the pal holds the spot you dropped it on before resuming.
const DRAG_HOLD_MS = 8000;

// Only flip the sprite when there's meaningful horizontal travel. The art has
// no up/down poses, so near-vertical movement must not cause facing flicker.
const FACING_EPSILON_PX = 1.5;

// Idle play: short hops around a toy dropped where the game started.
const PLAY_RADIUS_PX = 70;
const PLAY_SPEED_FACTOR = 1.25;
const PLAY_MIN_HOPS = 3;
const PLAY_MAX_HOPS = 6;

// How long a flourish plays before returning to idle (ms).
const FLOURISH_MS = {
  dance: 900,
  splash: 400,
  phone: 2000,
  crossed: 1500,
  thumbsup: 1200,
  jump: 500,
  glasses: 900,
  sit: 2000,
  wave: 900,
  stretch: 1400,
  lie: 2500,
  run: 900,
};
// Characters supply their own flourish sets, so a name may have no entry here.
// Without a fallback the phase timer becomes NaN and the pose never times out.
const FLOURISH_DEFAULT_MS = 1200;
const FLOURISH_WEIGHTS = { phone: 3, crossed: 3, splash: 2, thumbsup: 2, glasses: 2, dance: 1, jump: 1, sit: 2 };
const FLOURISHES = Object.keys(FLOURISH_WEIGHTS);

// --- Boredom ladder --------------------------------------------------------
// Ignore the pal and he works his way down these rungs, each one a bit more
// pointed than the last. Driven by system-wide input idle time, which main
// supplies via setSystemIdleMs — the ladder owns no clock of its own, so it
// measures "you stopped touching this computer" rather than "the pal has
// nothing queued".
//
// Rungs are data so one can be reordered or retimed without touching tick().
// Order matters: they are evaluated last-to-first, and each rung is entered at
// most once per idle spell.
//
// MINIME_BOREDOM_SCALE compresses the whole ladder for testing — the real
// timings run to fifteen minutes of sitting perfectly still, which is not a
// thing anyone can usefully check by hand. `MINIME_BOREDOM_SCALE=0.05 npm start`
// puts the doze rung 45 seconds out. Ignored unless it parses to a positive
// number, so a typo cannot accidentally disable the feature.
const BOREDOM_SCALE = (() => {
  const raw = Number(process.env.MINIME_BOREDOM_SCALE);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();
const BOREDOM_RUNGS = [
  { key: 'fidget', afterMs: 30 * 1000 * BOREDOM_SCALE },
  { key: 'sulk', afterMs: 2 * 60 * 1000 * BOREDOM_SCALE },
  { key: 'dock', afterMs: 5 * 60 * 1000 * BOREDOM_SCALE },
  { key: 'doze', afterMs: 15 * 60 * 1000 * BOREDOM_SCALE },
];
// Any input more recent than this counts as "you're back" and resets the
// ladder. Not zero: getSystemIdleTime has one-second resolution, so a freshly
// moved mouse can still report 0-1s on the next sample.
const BOREDOM_RESET_MS = 2000;
// Fidget rung: flourishes come this often instead of the usual 8-20s.
const FIDGET_IDLE_MIN_MS = 2500;
const FIDGET_IDLE_MAX_MS = 6000;
// How long the "oh! you're back" pose plays before normal service resumes.
const STARTLE_MS = 700;
// A rung asked for from the menu holds this long before the idle clock gets a
// say. Without it, the mouse movement that clicked the menu item would read as
// "you're back" and cancel the thing you just asked for.
const MANUAL_GRACE_MS = 5000;

// --- Dock trip -------------------------------------------------------------
const DOCK_PASSES_MIN = 2;
const DOCK_PASSES_MAX = 3;
// He's inspecting, not commuting.
const DOCK_PATROL_SPEED_FACTOR = 0.55;
// How long he waits for you to bring the cursor over before giving up.
const DOCK_ASK_MS = 20000;
// The Dock is centred on its edge, so patrol the middle stretch rather than
// the full span — walking into the corners would look like pathing, not
// looking.
const DOCK_SPAN_FRACTION = 0.55;
// Below this the patrol is too short to read as pacing, so skip the rung
// rather than have him twitch on the spot on a very small display.
const DOCK_MIN_SPAN_PX = 60;
// A revealed Dock is roughly its tile size plus the tray's own padding. Only
// needed when the Dock auto-hides: a pinned Dock is already excluded from the
// work area, so the edge of where he's allowed to walk is beside it anyway. A
// hidden one slides out over ground he's standing on and would cover him.
const DOCK_PAD_PX = 24;
const DOCK_ASK_TEXT = 'psst, bring your mouse over here?';
const DOZE_TEXT = 'zzz';

const STRETCH_BUBBLES = [
  "Time to stretch!",
  "Stand up for a sec?",
  "Shoulders. Roll 'em.",
  "Quick stretch break?",
  "Unfold those legs.",
  "Arms up, big breath.",
];

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function weightedPick(weights) {
  const entries = Object.entries(weights || {});
  // A character with no flourishes is valid; returning null makes the caller
  // simply skip the flourish instead of throwing inside the tick loop, which
  // would take the whole app down.
  if (!entries.length) return null;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

class PalState extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = {
      bounds: cfg.bounds, // { minX, maxX, minY, maxY } in screen coords
      houseDoor: cfg.houseDoor, // { x, y }
      walkSpeed: cfg.walkSpeed ?? 1.4,
      bubbleMs: cfg.bubbleMs ?? 8000,
      idleMinMs: cfg.idleMinMs ?? 8000,
      idleMaxMs: cfg.idleMaxMs ?? 20000,
      // Which idle flourishes this character can perform, as name -> weight.
      // Characters have different art, so the caller supplies the set.
      flourishes: cfg.flourishes ?? FLOURISH_WEIGHTS,
      boredomLadder: cfg.boredomLadder ?? true,
      dockTrip: cfg.dockTrip ?? true,
    };

    this.state = STATES.IDLE;
    this.x = cfg.startX ?? this.cfg.bounds.minX;
    this.y = cfg.startY ?? this.cfg.bounds.minY;
    this.facing = 1;
    this.targetX = null;
    this.targetY = null;
    this.bubbleText = null;
    this.animation = 'idle';
    this.houseState = HOUSE.CLOSED;

    this._idleTimer = randRange(this.cfg.idleMinMs, this.cfg.idleMaxMs);
    this._phaseTimer = 0;
    this._pendingReminder = null; // 'stretch' | 'water'
    this._reminderKind = null;
    this._flourish = null;
    this._flourishActive = false;
    this._waveTimer = 0;
    this._queuedReminder = null;

    this._followEnabled = false;
    this._cursorTarget = null; // { x, y }
    this._cursorIdle = false;

    this._dragging = false;
    this._dragHoldMs = 0;

    this._focusActive = false;
    this._pendingWork = false;

    this._playAnchor = null;
    this._playHopsLeft = 0;

    // Boredom ladder. Everything here is fed in from main: the ladder reads
    // the outside world, it doesn't sample it.
    this._sysIdleMs = 0;
    this._rung = 0; // 0 = attentive, 1..BOREDOM_RUNGS.length = how bored
    this._fidgeting = false;
    this._chair = null; // where he sits when he gives up; null = where he stands
    this._dock = null; // { edge, hidden, tileSize } or null
    this._cursorAtDock = false;
    this._pendingDock = false;
    this._pendingSulk = false;
    this._askMs = 0;
    this._patrolFrom = null;
    this._patrolTo = null;
    this._patrolVertical = false;
    this._patrolAtFar = false;
    this._patrolPassesLeft = 0;
    this._pendingDoze = false;
    // A rung asked for from the menu rather than reached by being ignored. It
    // has to be briefly exempt from the idle clock, because the mouse movement
    // that asked for it would otherwise read as "you're back" and cancel it.
    // The Dock trip stays exempt for its whole duration: with an auto-hidden
    // Dock the trip *needs* you to bring the mouse over.
    this._manual = null; // a BOREDOM_RUNGS key, or null
    this._manualGraceMs = 0;
  }

  // --- inputs from main ----------------------------------------------------

  // Milliseconds since the last keyboard or mouse event, system-wide.
  setSystemIdleMs(ms) {
    this._sysIdleMs = Number.isFinite(ms) ? ms : 0;
  }

  // { edge, hidden, tileSize } from dock.js, or null when unavailable.
  setDock(info) {
    this._dock = info || null;
  }

  // Whether the pointer is currently up against the Dock's edge. Computed by
  // main, which owns the screen geometry — passing a boolean avoids duplicating
  // the screen/local coordinate translation in here.
  setCursorAtDock(near) {
    this._cursorAtDock = !!near;
  }

  // Where he sits when he gives up on you: the focus-session work spot.
  setChair(spot) {
    this._chair = spot && typeof spot.x === 'number' ? { x: spot.x, y: spot.y } : null;
  }

  setBoredomEnabled(on) {
    this.cfg.boredomLadder = !!on;
    if (!on) this._resetLadder(false);
  }

  setDockTripEnabled(on) {
    this.cfg.dockTrip = !!on;
  }

  get bored() {
    return this._rung;
  }

  // Whether the Dock trip could be offered right now — the menu asks before
  // showing the item, so it isn't there to be clicked to no effect.
  get canInspectDock() {
    return this.cfg.dockTrip && !!this._dock && !this._focusActive && !this._dragging
      && !!this._dockPatrolLine();
  }

  // Whether a rung can be played on request. Deliberately does not require the
  // boredomLadder setting: that setting means "don't do this on your own", not
  // "I'm not allowed to ask".
  canPlayRung(key) {
    if (this._focusActive || this._dragging) return false;
    switch (this.state) {
      case STATES.SLEEPING:
      case STATES.GOING_HOME:
      case STATES.ENTERING_HOUSE:
      case STATES.WAKING:
      case STATES.EXITING_HOUSE:
        return false;
      default:
        break;
    }
    if (key === 'dock') return this.canInspectDock;
    return BOREDOM_RUNGS.some((r) => r.key === key);
  }

  // Do a rung now, on request, instead of waiting to be ignored into it. Same
  // behaviour the ladder would reach on its own — it just skips the waiting.
  //
  // The requested rung becomes his current rung, so if you then leave him alone
  // he carries on escalating from there rather than starting over.
  playRung(key) {
    if (!this.canPlayRung(key)) return false;
    this._resetLadder(false);
    this._manual = key;
    this._manualGraceMs = MANUAL_GRACE_MS;
    if (!this._enterRung(key, true)) {
      this._manual = null;
      this._manualGraceMs = 0;
      return false;
    }
    this._rung = BOREDOM_RUNGS.findIndex((r) => r.key === key) + 1;
    return true;
  }

  // The toy stays put and the character bounces around it.
  _beginPlay() {
    this.state = STATES.PLAYING;
    this.animation = 'play';
    this._playAnchor = { x: this.x, y: this.y };
    this._playHopsLeft = PLAY_MIN_HOPS + Math.floor(Math.random() * (PLAY_MAX_HOPS - PLAY_MIN_HOPS + 1));
    this._pickPlayHop();
  }

  _pickPlayHop() {
    const a = this._playAnchor;
    const p = this._clamp(
      a.x + randRange(-PLAY_RADIUS_PX, PLAY_RADIUS_PX),
      a.y + randRange(-PLAY_RADIUS_PX, PLAY_RADIUS_PX)
    );
    this.targetX = p.x;
    this.targetY = p.y;
  }

  get focusActive() {
    return this._focusActive;
  }

  // Walk to the work spot and sit down to work alongside you. Main owns the
  // session/break clocks; this just owns the pal's behavior.
  startWork(spot) {
    this._focusActive = true;
    // Safe here even mid-drag: beginDrag() has already cleared the ladder, so
    // this cannot knock the pal out of DRAGGED and lose the pending-work path.
    this._resetLadder(false);
    this._pendingReminder = null;
    this.bubbleText = null;
    this._waveTimer = 0;
    this._flourishActive = false;
    if (this.state === STATES.DRAGGED && this._dragging) {
      // Started a session while being held: sit as soon as it's put down.
      this._pendingWork = true;
      return true;
    }
    this._pendingWork = true;
    this._beginWalk(spot.x, spot.y);
    return true;
  }

  // Stand up and stretch for the duration of the break.
  startBreak(text, ms) {
    if (!this._focusActive) return false;
    this.state = STATES.BREAK;
    this.animation = 'stretch';
    this.bubbleText = text;
    this._phaseTimer = ms;
    return true;
  }

  stopWork() {
    if (!this._focusActive) return false;
    this._focusActive = false;
    this._pendingWork = false;
    this.bubbleText = null;
    if (this.state === STATES.WORKING || this.state === STATES.BREAK) {
      this._arriveIdle();
    }
    return true;
  }

  // Screen geometry can change (resolution, DPI, taskbar, monitor swap).
  setBounds(bounds, houseDoor) {
    this.cfg.bounds = bounds;
    if (houseDoor) this.cfg.houseDoor = houseDoor;
    const p = this._clamp(this.x, this.y);
    this.x = p.x;
    this.y = p.y;
    // A monitor change or a Dock being pinned mid-patrol moves the edge he's
    // pacing. Re-derive it, or send him home if there's no longer a line to
    // walk — otherwise he'd keep heading for a coordinate that no longer
    // exists.
    if (this._patrolFrom || this._patrolTo) {
      const line = this._dockPatrolLine();
      if (line) {
        this._patrolFrom = line.from;
        this._patrolTo = line.to;
        this._patrolVertical = line.vertical;
      } else {
        this._patrolFrom = null;
        this._patrolTo = null;
        if (this.state === STATES.PATROLLING) this._returnToChair();
      }
    }
  }

  _clamp(x, y) {
    const b = this.cfg.bounds;
    return {
      x: Math.min(Math.max(x, b.minX), b.maxX),
      y: Math.min(Math.max(y, b.minY), b.maxY),
    };
  }

  _randomPoint() {
    const b = this.cfg.bounds;
    return { x: randRange(b.minX, b.maxX), y: randRange(b.minY, b.maxY) };
  }

  // Move toward a point at the given per-tick speed. Returns true on arrival.
  _moveToward(tx, ty, speedPerTick, dtMs) {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    const step = speedPerTick * (dtMs / REFERENCE_TICK_MS);
    if (dist === 0 || dist <= step) {
      this.x = tx;
      this.y = ty;
      return true;
    }
    if (Math.abs(dx) > FACING_EPSILON_PX) this.facing = dx > 0 ? 1 : -1;
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    return false;
  }

  _canFollow() {
    return this.state === STATES.IDLE
      || this.state === STATES.FOLLOWING
      || this.state === STATES.RESTING;
  }

  playOneShot(anim, ms) {
    if (this.state !== STATES.IDLE && !this._canFollow()) return false;
    this._flourishActive = false;
    this._flourish = null;
    this._waveTimer = ms;
    this.animation = anim;
    return true;
  }

  wave() {
    // Clicking him is the way out of a pose he was told to hold. A requested
    // rung ignores the idle clock for a moment by design, and the Dock trip
    // ignores it throughout, so without this there'd be no way to cut one short.
    if (this._manual) this._resetLadder(false);
    return this.playOneShot('wave', 720); // 4 frames * 180ms
  }

  setFollow(enabled) {
    if (this._followEnabled === enabled) return;
    this._followEnabled = enabled;
    this._cursorTarget = null;
    this._cursorIdle = false;
    if (!enabled && (this.state === STATES.FOLLOWING || this.state === STATES.RESTING)) {
      this._arriveIdle();
      return;
    }
    // Entering follow mode mid-wander: abandon the random walk target so follow
    // engages now instead of after a walk that can take many seconds. A walk
    // delivering a reminder is left alone — reminders outrank follow.
    if (enabled && this.state === STATES.WALKING && !this._pendingReminder) {
      this._arriveIdle();
    }
  }

  updateCursor(x, y, cursorIdle) {
    this._cursorTarget = { x, y };
    this._cursorIdle = cursorIdle;
  }

  beginDrag() {
    if (this.state === STATES.SLEEPING
      || this.state === STATES.GOING_HOME
      || this.state === STATES.ENTERING_HOUSE
      || this.state === STATES.WAKING
      || this.state === STATES.EXITING_HOUSE) {
      return false;
    }
    if (this._pendingReminder && !this._queuedReminder) {
      this._queuedReminder = this._pendingReminder;
    }
    // Picking him up is attention, so the ladder unwinds. Clearing it here
    // rather than relying on the idle clock also means startWork() can safely
    // reset while he's still held.
    this._resetLadder(false);
    this._pendingReminder = null;
    this.bubbleText = null;
    this._waveTimer = 0;
    this._flourishActive = false;
    this._dragging = true;
    this._dragHoldMs = 0;
    this.state = STATES.DRAGGED;
    this.animation = 'idle';
    return true;
  }

  dragTo(x, y) {
    if (!this._dragging) return;
    const p = this._clamp(x, y);
    this.x = p.x;
    this.y = p.y;
  }

  endDrag() {
    if (!this._dragging) return;
    this._dragging = false;
    this._dragHoldMs = DRAG_HOLD_MS;
  }

  _drainQueuedReminder() {
    if (!this._queuedReminder) return;
    const queued = this._queuedReminder;
    this._queuedReminder = null;
    this.requestReminder(queued);
  }

  requestReminder(kind) {
    if (this.state === STATES.DRAGGED) {
      if (!this._queuedReminder) this._queuedReminder = kind;
      return false;
    }
    // The boredom states MUST be in here. Reminders are what this app is for,
    // and a stretch or water nudge that silently vanishes because the pal
    // happened to be off inspecting the Dock is a far worse bug than any
    // amount of missed idle charm.
    const interruptible = this.state === STATES.IDLE
      || this.state === STATES.WALKING
      || this.state === STATES.FOLLOWING
      || this.state === STATES.RESTING
      || this.state === STATES.PLAYING
      || this.state === STATES.SULKING
      || this.state === STATES.ASKING_CURSOR
      || this.state === STATES.PATROLLING
      || this.state === STATES.DOZING;
    if (!interruptible) return false;
    if (this._pendingReminder && this._pendingReminder !== kind) {
      if (!this._queuedReminder) this._queuedReminder = kind;
      return false;
    }
    // He has a job now, so he is no longer being ignored.
    this._resetLadder(false);
    this._pendingReminder = kind;
    this._flourish = null;
    const b = this.cfg.bounds;
    this._beginWalk((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    return true;
  }

  requestSleep() {
    if (this.state === STATES.SLEEPING || this.state === STATES.GOING_HOME || this.state === STATES.ENTERING_HOUSE) {
      return false;
    }
    // Going to bed ends any focus session, or main's session clock would keep
    // running and try to start a break while the pal is asleep in the house.
    if (this._focusActive) {
      this._focusActive = false;
      this._pendingWork = false;
      this.emit('focusStopped');
    }
    this._resetLadder(false);
    this._pendingReminder = null;
    this._queuedReminder = null;
    this.bubbleText = null;
    this._dragging = false;
    this.state = STATES.GOING_HOME;
    this.animation = 'run';
    this.targetX = this.cfg.houseDoor.x;
    this.targetY = this.cfg.houseDoor.y;
    return true;
  }

  requestWake() {
    if (this.state !== STATES.SLEEPING) return false;
    this.state = STATES.WAKING;
    this.houseState = HOUSE.OPEN;
    this._phaseTimer = 400;
    return true;
  }

  _beginWalk(targetX, targetY) {
    this.targetX = targetX;
    this.targetY = targetY;
    if (Math.abs(targetX - this.x) > FACING_EPSILON_PX) {
      this.facing = targetX >= this.x ? 1 : -1;
    }
    this.state = STATES.WALKING;
    this.animation = 'walk';
  }

  _arriveIdle() {
    this.state = STATES.IDLE;
    this.animation = 'idle';
    this._playAnchor = null;
    this._playHopsLeft = 0;
    this.targetX = null;
    this.targetY = null;
    this._flourish = null;
    this._idleTimer = this._nextIdleDelay();
  }

  // Gap before the next wander or flourish. Shorter on the fidget rung, which
  // is the whole of what that rung does — it adds no poses of its own.
  _nextIdleDelay() {
    return this._fidgeting
      ? randRange(FIDGET_IDLE_MIN_MS, FIDGET_IDLE_MAX_MS)
      : randRange(this.cfg.idleMinMs, this.cfg.idleMaxMs);
  }

  // --- boredom ladder ------------------------------------------------------

  _inLadder() {
    return this.state === STATES.SULKING
      || this.state === STATES.ASKING_CURSOR
      || this.state === STATES.PATROLLING
      || this.state === STATES.DOZING;
  }

  // Back to normal service. `startle` plays the "oh — you're back" pose, which
  // is only wanted when a human actually returned, not when the feature was
  // switched off or the pal was sent to bed.
  _resetLadder(startle) {
    const wasEngaged = this._inLadder() || this._pendingDock || this._pendingSulk
      || this._pendingDoze;
    this._rung = 0;
    this._fidgeting = false;
    this._pendingDock = false;
    this._pendingSulk = false;
    this._pendingDoze = false;
    this._askMs = 0;
    this._patrolPassesLeft = 0;
    this._patrolFrom = null;
    this._patrolTo = null;
    this._manual = null;
    this._manualGraceMs = 0;
    if (this.bubbleText === DOCK_ASK_TEXT || this.bubbleText === DOZE_TEXT) {
      this.bubbleText = null;
    }
    if (!wasEngaged) return;
    this._arriveIdle();
    if (startle) {
      this.animation = 'startle';
      this._waveTimer = STARTLE_MS;
    }
  }

  // True while a rung asked for from the menu is exempt from the idle clock.
  //
  // The exemption exists because the mouse movement that picked the menu item is
  // itself input, and would otherwise cancel the thing it just asked for.
  _manualHolding(dtMs) {
    if (!this._manual) return false;
    // The Dock trip is exempt for its whole length, not just at the start: it
    // asks you to bring the mouse over, so it cannot treat a moved mouse as an
    // interruption.
    if (this._manual === 'dock') return true;
    // The clock doesn't start until he's actually got where he's going. Walking
    // to his chair takes longer than any sensible grace period, and cancelling
    // him en route means the menu item visibly does nothing.
    if (this._pendingSulk || this._pendingDoze || this._pendingDock) return true;
    if (this._manualGraceMs > 0) {
      this._manualGraceMs -= dtMs;
      return true;
    }
    // Grace over. From here it behaves exactly like the rung reached on its own:
    // input startles him out of it, and continued quiet escalates him onward.
    this._manual = null;
    return false;
  }

  _ladderTick(dtMs) {
    if (this._manualHolding(dtMs)) return;
    // Everything below outranks boredom: a focus session is meant to be still,
    // a reminder is the app's actual job, and the house sleep is deliberate.
    if (this._focusActive || this._dragging) return;
    switch (this.state) {
      case STATES.REMINDING:
      case STATES.WORKING:
      case STATES.BREAK:
      case STATES.DRAGGED:
      case STATES.GOING_HOME:
      case STATES.ENTERING_HOUSE:
      case STATES.SLEEPING:
      case STATES.WAKING:
      case STATES.EXITING_HOUSE:
        return;
      default:
        break;
    }

    if (this._sysIdleMs < BOREDOM_RESET_MS) {
      if (this._rung > 0) this._resetLadder(true);
      return;
    }

    // Only the escalation is governed by the setting. The reset above runs
    // either way, so a rung played from the menu with the ladder switched off
    // is still something input can get him out of, rather than a stuck pose.
    if (!this.cfg.boredomLadder) return;

    let target = 0;
    for (let i = 0; i < BOREDOM_RUNGS.length; i++) {
      if (this._sysIdleMs >= BOREDOM_RUNGS[i].afterMs) target = i + 1;
    }

    // Advance one rung at a time. A rung that declines (no Dock on this
    // platform, say) is still marked done so the ladder falls through to the
    // next one instead of retrying it every tick.
    while (this._rung < target) {
      const next = this._rung + 1;
      const entered = this._enterRung(BOREDOM_RUNGS[next - 1].key);
      this._rung = next;
      if (entered) return;
    }
  }

  // `asked` is true when this rung was picked from the menu rather than reached
  // by escalation. It only changes where a rung starts from, never what it does:
  // the ladder always arrives at these having already walked him to his chair,
  // and a rung played out of order has to get itself there.
  _enterRung(key, asked) {
    switch (key) {
      case 'fidget': return this._beginFidget(asked);
      case 'sulk': return this._beginSulk();
      case 'dock': return this._beginDockTrip();
      case 'doze': return this._beginDoze(asked);
      default: return false;
    }
  }

  _beginFidget(asked) {
    this._fidgeting = true;
    // Apply now rather than after the current 8-20s timer runs down, or the
    // rung would appear to do nothing for up to 20 seconds. Asked for directly,
    // fidget the moment the menu closes — otherwise nothing visible happens and
    // it looks like the menu item did nothing at all.
    if (asked && !this._canFollow()) this._arriveIdle();
    // Set after _arriveIdle, which arms a fresh idle delay of its own.
    this._idleTimer = asked ? 0 : Math.min(this._idleTimer, FIDGET_IDLE_MAX_MS);
    return true;
  }

  // Sit down in his chair. Walks there first if he isn't already on it.
  _beginSulk() {
    const seat = this._chair ? this._clamp(this._chair.x, this._chair.y) : null;
    if (!seat || Math.hypot(seat.x - this.x, seat.y - this.y) < 2) {
      this.state = STATES.SULKING;
      this.animation = 'sit';
      this.targetX = null;
      this.targetY = null;
      return true;
    }
    this._pendingSulk = true;
    this._beginWalk(seat.x, seat.y);
    return true;
  }

  _beginDockTrip() {
    if (!this.cfg.dockTrip) return false;
    const line = this._dockPatrolLine();
    if (!line) return false;
    this._patrolFrom = line.from;
    this._patrolTo = line.to;
    this._patrolVertical = line.vertical;
    this._patrolAtFar = false;
    this._patrolPassesLeft = DOCK_PASSES_MIN
      + Math.floor(Math.random() * (DOCK_PASSES_MAX - DOCK_PASSES_MIN + 1));
    this._pendingSulk = false;
    this._pendingDock = true;
    this.bubbleText = null;
    this._beginWalk(line.from.x, line.from.y);
    return true;
  }

  // The stretch of Dock edge he paces, in pal coordinates.
  //
  // The pal's window only covers the work area, and macOS removes a *pinned*
  // Dock from the work area — so he cannot stand on the Dock, only alongside
  // it. This walks the edge of where he's allowed to be, which is immediately
  // beside the Dock either way.
  _dockPatrolLine() {
    const d = this._dock;
    if (!d) return null;
    const b = this.cfg.bounds;
    // Stand clear of where an auto-hidden Dock will slide out to, or it reveals
    // itself on top of him and the whole trip happens behind the Dock.
    const clear = d.hidden ? d.tileSize + DOCK_PAD_PX : 0;
    if (d.edge === 'bottom') {
      const span = (b.maxX - b.minX) * DOCK_SPAN_FRACTION;
      if (span < DOCK_MIN_SPAN_PX) return null;
      const mid = (b.minX + b.maxX) / 2;
      const y = Math.max(b.minY, b.maxY - clear);
      return {
        vertical: false,
        from: { x: mid - span / 2, y },
        to: { x: mid + span / 2, y },
      };
    }
    if (d.edge !== 'left' && d.edge !== 'right') return null;
    const span = (b.maxY - b.minY) * DOCK_SPAN_FRACTION;
    if (span < DOCK_MIN_SPAN_PX) return null;
    const mid = (b.minY + b.maxY) / 2;
    const x = d.edge === 'left'
      ? Math.min(b.maxX, b.minX + clear)
      : Math.max(b.minX, b.maxX - clear);
    return {
      vertical: true,
      from: { x, y: mid - span / 2 },
      to: { x, y: mid + span / 2 },
    };
  }

  _beginPatrol() {
    this.bubbleText = null;
    this.state = STATES.PATROLLING;
    this._patrolAtFar = false;
    // The art has no up/down poses, so a vertical patrol must not use the walk
    // cycle — it would read as sliding sideways. See FACING_EPSILON_PX.
    this.animation = this._patrolVertical ? 'inspect' : 'walk';
    if (this._patrolVertical && this._dock) {
      // Vertical travel never updates facing, so point him at the Dock once.
      this.facing = this._dock.edge === 'right' ? 1 : -1;
    }
  }

  _beginDoze(walkToChairFirst) {
    this._pendingDock = false;
    this._pendingSulk = false;
    this._pendingDoze = false;
    // Reached by escalation he is already sitting in his chair, having given up
    // on you thirteen minutes earlier. Asked for out of order he could be
    // anywhere, and dozing off mid-stride looks like a freeze, so he goes and
    // sits down first.
    if (walkToChairFirst) {
      const seat = this._chair ? this._clamp(this._chair.x, this._chair.y) : null;
      if (seat && Math.hypot(seat.x - this.x, seat.y - this.y) >= 2) {
        this._pendingDoze = true;
        this._beginWalk(seat.x, seat.y);
        return true;
      }
    }
    this.state = STATES.DOZING;
    this.animation = 'doze';
    this.bubbleText = DOZE_TEXT;
    this.targetX = null;
    this.targetY = null;
    return true;
  }

  _returnToChair() {
    const seat = this._chair ? this._clamp(this._chair.x, this._chair.y) : null;
    this.bubbleText = null;
    this._pendingDock = false;
    this._patrolPassesLeft = 0;
    // He wasn't sulking, he was running an errand — so he goes back to
    // wandering rather than sitting down in a huff.
    if (this._manual === 'dock') {
      this._manual = null;
      this._manualGraceMs = 0;
      this._rung = 0;
      this._pendingSulk = false;
      this._arriveIdle();
      return;
    }
    if (!seat || Math.hypot(seat.x - this.x, seat.y - this.y) < 2) {
      this._pendingSulk = false;
      this.state = STATES.SULKING;
      this.animation = 'sit';
      this.targetX = null;
      this.targetY = null;
      return;
    }
    this._pendingSulk = true;
    this._beginWalk(seat.x, seat.y);
  }

  _tickFollow(dtMs) {
    if (this._waveTimer > 0) {
      this._waveTimer -= dtMs;
      if (this._waveTimer <= 0) {
        this._waveTimer = 0;
        this.animation = 'idle';
      }
      return;
    }

    const target = this._clamp(this._cursorTarget.x, this._cursorTarget.y);
    const dist = Math.hypot(target.x - this.x, target.y - this.y);

    if (dist > FOLLOW_DEADZONE_PX) {
      this.state = STATES.FOLLOWING;
      this.animation = 'walk';
      this._moveToward(target.x, target.y, this.cfg.walkSpeed * FOLLOW_SPEED_FACTOR, dtMs);
      return;
    }

    // Arrived under the cursor: sit once the cursor has gone idle, else stand.
    // Drive this off the animation, not the state — a wave played while already
    // RESTING would otherwise never restore the sit pose.
    if (this._cursorIdle) {
      this.state = STATES.RESTING;
      this.animation = 'sit';
    } else {
      this.state = STATES.FOLLOWING;
      this.animation = 'idle';
    }
  }

  tick(dtMs) {
    if (this.state === STATES.DRAGGED) {
      if (!this._dragging) {
        // Dropped during a focus session: sit and get back to work right where
        // it was put, rather than wandering off after the usual hold.
        if (this._focusActive) {
          this.state = STATES.WORKING;
          this.animation = 'sit';
          this._pendingWork = false;
          this.emit('workSpotMoved', { x: this.x, y: this.y });
          return;
        }
        this._dragHoldMs -= dtMs;
        if (this._dragHoldMs <= 0) {
          this._arriveIdle();
          this._drainQueuedReminder();
        }
      }
      return;
    }

    // Before the follow check on purpose. If you leave the cursor parked with
    // follow-cursor on, being sat next to a motionless mouse still counts as
    // being ignored — the ladder engages, and because its states aren't in
    // _canFollow() it then holds until you actually come back.
    this._ladderTick(dtMs);

    if (this._followEnabled && this._cursorTarget !== null && this._canFollow()) {
      this._tickFollow(dtMs);
      return;
    }

    switch (this.state) {
      case STATES.IDLE: {
        if (this._waveTimer > 0) {
          this._waveTimer -= dtMs;
          if (this._waveTimer <= 0) {
            this._waveTimer = 0;
            this.animation = 'idle';
          }
          break;
        }
        this._idleTimer -= dtMs;
        if (this._idleTimer <= 0) {
          if (Math.random() < 0.55) {
            const p = this._randomPoint();
            this._beginWalk(p.x, p.y);
          } else {
            this._flourish = weightedPick(this.cfg.flourishes);
            if (this._flourish === 'play') {
              this._beginPlay();
              this._idleTimer = this._nextIdleDelay();
              break;
            }
            if (this._flourish) {
              this.animation = this._flourish;
              this._phaseTimer = FLOURISH_MS[this._flourish] ?? FLOURISH_DEFAULT_MS;
              this._flourishActive = true;
            }
          }
          this._idleTimer = this._nextIdleDelay();
        } else if (this._flourishActive) {
          this._phaseTimer -= dtMs;
          if (this._phaseTimer <= 0) {
            this._flourishActive = false;
            this._flourish = null;
            this.animation = 'idle';
          }
        }
        break;
      }

      case STATES.PLAYING: {
        if (this._moveToward(this.targetX, this.targetY, this.cfg.walkSpeed * PLAY_SPEED_FACTOR, dtMs)) {
          this._playHopsLeft -= 1;
          if (this._playHopsLeft <= 0) this._arriveIdle();
          else this._pickPlayHop();
        }
        break;
      }

      case STATES.WORKING:
        // Sits still and works. Wandering, flourishes, and follow are all
        // suppressed — that's the entire point of a focus session.
        break;

      case STATES.BREAK: {
        this._phaseTimer -= dtMs;
        if (this._phaseTimer <= 0) {
          this.bubbleText = null;
          this.emit('breakComplete');
        }
        break;
      }

      case STATES.WALKING: {
        if (this._moveToward(this.targetX, this.targetY, this.cfg.walkSpeed, dtMs)) {
          if (this._pendingWork) {
            this._pendingWork = false;
            this.state = STATES.WORKING;
            this.animation = 'sit';
          } else if (this._pendingReminder) {
            const kind = this._pendingReminder;
            this._pendingReminder = null;
            this.state = STATES.REMINDING;
            this.animation = kind === 'stretch' ? 'stretch' : 'drink';
            this.bubbleText = kind === 'stretch'
              ? STRETCH_BUBBLES[Math.floor(Math.random() * STRETCH_BUBBLES.length)]
              : 'Water time';
            this._reminderKind = kind;
            this._phaseTimer = kind === 'stretch' ? this.cfg.bubbleMs : 1500;
          } else if (this._pendingDock) {
            this._pendingDock = false;
            // A hidden Dock isn't there to be looked at, and nothing this app
            // does can reveal it — only the real pointer can. So ask.
            if (this._dock && this._dock.hidden && !this._cursorAtDock) {
              this.state = STATES.ASKING_CURSOR;
              this.animation = 'ask';
              this.bubbleText = DOCK_ASK_TEXT;
              this._askMs = DOCK_ASK_MS;
            } else {
              this._beginPatrol();
            }
          } else if (this._pendingDoze) {
            this._beginDoze(false);
          } else if (this._pendingSulk) {
            this._pendingSulk = false;
            this.state = STATES.SULKING;
            this.animation = 'sit';
            this.targetX = null;
            this.targetY = null;
          } else {
            this._arriveIdle();
          }
        }
        break;
      }

      case STATES.ASKING_CURSOR: {
        if (this._cursorAtDock) {
          this._beginPatrol();
          break;
        }
        this._askMs -= dtMs;
        if (this._askMs <= 0) this._returnToChair(); // nobody came
        break;
      }

      case STATES.PATROLLING: {
        const leg = this._patrolAtFar ? this._patrolFrom : this._patrolTo;
        // setBounds can drop the patrol line mid-walk (monitor change).
        if (!leg) {
          this._returnToChair();
          break;
        }
        if (this._moveToward(leg.x, leg.y, this.cfg.walkSpeed * DOCK_PATROL_SPEED_FACTOR, dtMs)) {
          this._patrolAtFar = !this._patrolAtFar;
          this._patrolPassesLeft -= 1;
          if (this._patrolPassesLeft <= 0) this._returnToChair();
        }
        break;
      }

      case STATES.SULKING:
      case STATES.DOZING:
        // Both just hold their pose. The ladder decides when he moves on, and
        // returning input resets it.
        break;

      case STATES.REMINDING: {
        this._phaseTimer -= dtMs;
        if (this._phaseTimer <= 0) {
          const kind = this._reminderKind;
          this.bubbleText = null;
          this._reminderKind = null;
          this._arriveIdle();
          this.emit('reminderComplete', kind);
          this._drainQueuedReminder();
        }
        break;
      }

      case STATES.GOING_HOME: {
        if (this._moveToward(this.targetX, this.targetY, this.cfg.walkSpeed, dtMs)) {
          this.state = STATES.ENTERING_HOUSE;
          this.animation = 'idle';
          this._phaseTimer = 600;
        }
        break;
      }

      case STATES.ENTERING_HOUSE: {
        this._phaseTimer -= dtMs;
        if (this._phaseTimer <= 0) {
          this.state = STATES.SLEEPING;
          this.houseState = HOUSE.NIGHT;
          this.emit('sleeping');
        }
        break;
      }

      case STATES.SLEEPING:
        break;

      case STATES.WAKING: {
        this._phaseTimer -= dtMs;
        if (this._phaseTimer <= 0) {
          this.state = STATES.EXITING_HOUSE;
          this.animation = 'run';
          this.x = this.cfg.houseDoor.x;
          this.y = this.cfg.houseDoor.y;
          const p = this._randomPoint();
          this.targetX = p.x;
          this.targetY = p.y;
          this.houseState = HOUSE.CLOSED;
        }
        break;
      }

      case STATES.EXITING_HOUSE: {
        if (this._moveToward(this.targetX, this.targetY, this.cfg.walkSpeed, dtMs)) {
          this._arriveIdle();
          this.emit('awake');
        }
        break;
      }

      default:
        break;
    }
  }

  serialize() {
    return {
      state: this.state,
      x: this.x,
      y: this.y,
      facing: this.facing,
      animation: this.animation,
      bubbleText: this.bubbleText,
      houseState: this.houseState,
      playAnchor: this._playAnchor,
    };
  }
}

// BOREDOM_RUNGS is exported so the menu can list the rungs and label them with
// their real timings, rather than keeping a second copy of the table that would
// quietly drift out of step with this one.
module.exports = { PalState, STATES, HOUSE, FLOURISHES, BOREDOM_RUNGS };
