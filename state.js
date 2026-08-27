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
});

const HOUSE = Object.freeze({ CLOSED: 'closed', OPEN: 'open', NIGHT: 'night' });

// walkSpeed is calibrated as "px per REFERENCE_TICK_MS", not px/ms directly —
// scaling by raw dtMs (16ms ticks) made the pal cover ~1400px/sec (a blink-
// and-you-miss-it dash instead of a walk).
const REFERENCE_TICK_MS = 16;

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
};
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
  const entries = Object.entries(weights);
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
      laneMinX: cfg.laneMinX,
      laneMaxX: cfg.laneMaxX,
      houseDoorX: cfg.houseDoorX,
      walkSpeed: cfg.walkSpeed ?? 1.4, // px/ms
      bubbleMs: cfg.bubbleMs ?? 8000,
      idleMinMs: cfg.idleMinMs ?? 8000,
      idleMaxMs: cfg.idleMaxMs ?? 20000,
    };

    this.state = STATES.IDLE;
    this.x = cfg.startX ?? this.cfg.laneMinX;
    this.facing = 1;
    this.targetX = null;
    this.bubbleText = null;
    this.animation = 'idle';
    this.houseState = HOUSE.CLOSED;

    this._idleTimer = randRange(this.cfg.idleMinMs, this.cfg.idleMaxMs);
    this._phaseTimer = 0;
    this._pendingReminder = null; // 'stretch' | 'water'
    this._flourish = null;
    this._flourishActive = false;
    this._waveTimer = 0;
    this._queuedReminder = null;
  }

  requestReminder(kind) {
    if (this.state !== STATES.IDLE && this.state !== STATES.WALKING) return false;
    if (this._pendingReminder && this._pendingReminder !== kind) {
      // Already walking to deliver a different reminder — queue this one
      // instead of clobbering it (stretch/water intervals can collide).
      if (!this._queuedReminder) this._queuedReminder = kind;
      return false;
    }
    this._pendingReminder = kind;
    this._flourish = null;
    const center = (this.cfg.laneMinX + this.cfg.laneMaxX) / 2;
    this._beginWalk(center);
    return true;
  }

  wave() {
    if (this.state !== STATES.IDLE) return false;
    this._flourishActive = false;
    this._flourish = null;
    this._waveTimer = 720; // matches wave animation: 4 frames * 180ms
    this.animation = 'wave';
    return true;
  }

  requestSleep() {
    if (this.state === STATES.SLEEPING || this.state === STATES.GOING_HOME || this.state === STATES.ENTERING_HOUSE) {
      return false;
    }
    this._pendingReminder = null;
    this._queuedReminder = null;
    this.bubbleText = null;
    this.state = STATES.GOING_HOME;
    this.animation = 'walk';
    this.targetX = this.cfg.houseDoorX;
    return true;
  }

  requestWake() {
    if (this.state !== STATES.SLEEPING) return false;
    this.state = STATES.WAKING;
    this.houseState = HOUSE.OPEN;
    this._phaseTimer = 400;
    return true;
  }

  _beginWalk(targetX) {
    this.targetX = targetX;
    this.facing = targetX >= this.x ? 1 : -1;
    this.state = STATES.WALKING;
    this.animation = 'walk';
  }

  _arriveIdle() {
    this.state = STATES.IDLE;
    this.animation = 'idle';
    this.targetX = null;
    this._flourish = null;
    this._idleTimer = randRange(this.cfg.idleMinMs, this.cfg.idleMaxMs);
  }

  tick(dtMs) {
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
            const nx = randRange(this.cfg.laneMinX, this.cfg.laneMaxX);
            this._beginWalk(nx);
          } else {
            this._flourish = weightedPick(FLOURISH_WEIGHTS);
            this.animation = this._flourish;
            this._phaseTimer = FLOURISH_MS[this._flourish];
            this._flourishActive = true;
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

      case STATES.WALKING: {
        const dir = this.targetX >= this.x ? 1 : -1;
        this.facing = dir;
        this.x += dir * this.cfg.walkSpeed * (dtMs / REFERENCE_TICK_MS);
        const arrived = (dir === 1 && this.x >= this.targetX) || (dir === -1 && this.x <= this.targetX);
        if (arrived) {
          this.x = this.targetX;
          if (this._pendingReminder) {
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
          if (this._queuedReminder) {
            const queued = this._queuedReminder;
            this._queuedReminder = null;
            this.requestReminder(queued);
          }
        }
        break;
      }

      case STATES.GOING_HOME: {
        const dir = this.targetX >= this.x ? 1 : -1;
        this.facing = dir;
        this.x += dir * this.cfg.walkSpeed * (dtMs / REFERENCE_TICK_MS);
        const arrived = (dir === 1 && this.x >= this.targetX) || (dir === -1 && this.x <= this.targetX);
        if (arrived) {
          this.x = this.targetX;
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
          this.animation = 'walk';
          this.x = this.cfg.houseDoorX;
          this.targetX = randRange(this.cfg.laneMinX, this.cfg.laneMaxX);
          this.houseState = HOUSE.CLOSED;
        }
        break;
      }

      case STATES.EXITING_HOUSE: {
        const dir = this.targetX >= this.x ? 1 : -1;
        this.facing = dir;
        this.x += dir * this.cfg.walkSpeed * (dtMs / REFERENCE_TICK_MS);
        const arrived = (dir === 1 && this.x >= this.targetX) || (dir === -1 && this.x <= this.targetX);
        if (arrived) {
          this.x = this.targetX;
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
      facing: this.facing,
      animation: this.animation,
      bubbleText: this.bubbleText,
      houseState: this.houseState,
    };
  }
}

module.exports = { PalState, STATES, HOUSE, FLOURISHES };
