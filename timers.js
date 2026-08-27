'use strict';

class PausableTimer {
  constructor(ms, onFire) {
    this.total = ms;
    this.remaining = ms;
    this.onFire = onFire;
    this.running = false;
    this.handle = null;
    this._startedAt = 0;
  }

  start() {
    if (this.running || this.remaining <= 0) return;
    this.running = true;
    this._startedAt = Date.now();
    this.handle = setTimeout(() => this._fire(), this.remaining);
  }

  pause() {
    if (!this.running) return;
    clearTimeout(this.handle);
    this.handle = null;
    this.remaining -= Date.now() - this._startedAt;
    if (this.remaining < 0) this.remaining = 0;
    this.running = false;
  }

  reset(ms) {
    this.pause();
    if (typeof ms === 'number') this.total = ms;
    this.remaining = this.total;
  }

  fireNow() {
    this.pause();
    this.onFire();
    this.reset();
  }

  _fire() {
    this.running = false;
    this.handle = null;
    this.onFire();
    this.reset();
    this.start();
  }
}

class ReminderTimers {
  constructor({ stretchIntervalMin, waterIntervalMin, onStretch, onWater }) {
    this.stretch = new PausableTimer(stretchIntervalMin * 60 * 1000, onStretch);
    this.water = new PausableTimer(waterIntervalMin * 60 * 1000, onWater);
  }

  start() {
    this.stretch.start();
    this.water.start();
  }

  pauseAll() {
    this.stretch.pause();
    this.water.pause();
  }

  resumeAll() {
    this.stretch.start();
    this.water.start();
  }

  setIntervals({ stretchIntervalMin, waterIntervalMin }) {
    if (typeof stretchIntervalMin === 'number') this.stretch.reset(stretchIntervalMin * 60 * 1000);
    if (typeof waterIntervalMin === 'number') this.water.reset(waterIntervalMin * 60 * 1000);
    this.stretch.start();
    this.water.start();
  }
}

module.exports = { PausableTimer, ReminderTimers };
