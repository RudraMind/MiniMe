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
    const interruptible = this.state === STATES.IDLE
      || this.state === STATES.WALKING
      || this.state === STATES.FOLLOWING
      || this.state === STATES.RESTING
      || this.state === STATES.PLAYING;
    if (!interruptible) return false;
    if (this._pendingReminder && this._pendingReminder !== kind) {
      if (!this._queuedReminder) this._queuedReminder = kind;
      return false;
    }
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
    this._idleTimer = randRange(this.cfg.idleMinMs, this.cfg.idleMaxMs);
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
              this._idleTimer = randRange(this.cfg.idleMinMs, this.cfg.idleMaxMs);
              break;
            }
            if (this._flourish) {
              this.animation = this._flourish;
              this._phaseTimer = FLOURISH_MS[this._flourish] ?? FLOURISH_DEFAULT_MS;
              this._flourishActive = true;
            }
          }
          this._idleTimer = randRange(this.cfg.idleMinMs, this.cfg.idleMaxMs);
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
          } else {
            this._arriveIdle();
          }
        }
        break;
      }

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

module.exports = { PalState, STATES, HOUSE, FLOURISHES };
