'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, globalShortcut, nativeImage, dialog } = require('electron');
const Store = require('electron-store');
const { PalState, HOUSE } = require('./state');
const { ReminderTimers } = require('./timers');

// Must match the size the slicer writes (tools/slice-house.js OUT_W) and the
// values in renderer/pet.js. The art is square.
const HOUSE_W = 120;
const HOUSE_H = 120;
const PAL_W = 72;
const PAL_H = 72;
const TICK_MS = 16;

const store = new Store({
  defaults: {
    stretchIntervalMin: 60,
    waterIntervalMin: 45,
    overlaySeconds: 10,
    bubbleMs: 8000,
    walkSpeed: 1.4,
    startWithWindows: false,
    quietHours: { enabled: false, start: '22:00', end: '07:00' },
    petVisible: true,
    lastState: 'IDLE',
    shirtColor: 'default',
    pantColor: 'default',
    // null = park the house in the default top-right corner; once dragged, this
    // holds { x, y } in screen coordinates.
    housePos: null,
    followCursor: false,
    focusMoods: false,
    palName: 'Raj',
    focusSessionMin: 25,
    focusBreakMin: 5,
    // Where the pal sits during a focus session; null = center of the screen.
    workSpot: null,
    history: [],
  },
});

let petWindow = null;
let overlayWindow = null;
let settingsWindow = null;
let tray = null;
let pal = null;
let timers = null;
let tickHandle = null;
let workArea = null;

function getConfig() {
  return store.store;
}

const CONFIG_MIN = {
  stretchIntervalMin: 1,
  waterIntervalMin: 1,
  overlaySeconds: 3,
  bubbleMs: 1000,
  walkSpeed: 0.2,
  focusSessionMin: 1,
  focusBreakMin: 1,
};

function palName() {
  const n = store.get('palName', 'Raj');
  return (typeof n === 'string' && n.trim()) ? n.trim() : 'Raj';
}

function setConfig(patch) {
  for (const [k, v] of Object.entries(patch)) {
    const min = CONFIG_MIN[k];
    const clamped = typeof v === 'number' && typeof min === 'number' ? Math.max(v, min) : v;
    store.set(k, clamped);
  }
  return getConfig();
}

function pushHistory(entry) {
  const history = store.get('history', []);
  history.push(entry);
  while (history.length > 500) history.shift();
  store.set('history', history);
}

function computeWorkArea() {
  return screen.getPrimaryDisplay().workArea;
}

// The pal roams the whole work area. x/y are the sprite's top-left corner, so
// the maxima are inset by the sprite size to keep it fully on screen.
function roamBounds() {
  return {
    minX: workArea.x,
    maxX: workArea.x + workArea.width - PAL_W,
    minY: workArea.y,
    maxY: workArea.y + workArea.height - PAL_H,
  };
}

// Position held in memory while the house is being dragged. electron-store
// writes to disk synchronously (~1.5ms), so persisting on every mousemove would
// mean hundreds of blocking writes per drag, stalling the 16ms animation tick.
// It is written once, on drop.
let liveHousePos = null;

// Top-left corner of the house, defaulting to the top-right of the work area.
function housePosition() {
  const stored = liveHousePos || store.get('housePos', null);
  const fallbackX = workArea.x + workArea.width - HOUSE_W;
  const fallbackY = workArea.y;
  const x = stored && typeof stored.x === 'number' ? stored.x : fallbackX;
  const y = stored && typeof stored.y === 'number' ? stored.y : fallbackY;
  // Clamp so a house dragged before a resolution change can't end up off-screen.
  return {
    x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - HOUSE_W),
    y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - HOUSE_H),
  };
}

// Persist a dragged house position exactly once, when the drag ends.
function commitHousePos() {
  if (!liveHousePos) return;
  store.set('housePos', liveHousePos);
  liveHousePos = null;
}

// Where the pal stands to enter the house: centered on its doorway.
function houseDoor() {
  const h = housePosition();
  return {
    x: h.x + HOUSE_W / 2 - PAL_W / 2,
    y: h.y + HOUSE_H - PAL_H,
  };
}

// The pet window now covers the entire work area so the pal can walk anywhere.
// It stays click-through except while the cursor is over the pal or the house.
function petWindowBounds() {
  return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
}

function createPetWindow() {
  const bounds = petWindowBounds();
  petWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  petWindow.setAlwaysOnTop(true, 'screen-saver');
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  petWindow.on('closed', () => { petWindow = null; });
}

function openOverlay(kind) {
  if (overlayWindow) return;
  overlayWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  // The pet window is now full-screen and also at 'screen-saver' level, so
  // z-order between the two isn't guaranteed — the pal could wander across the
  // overlay. Hide it for the duration; the overlay renders its own pal.
  const petWasVisible = petWindow && !petWindow.isDestroyed() && petWindow.isVisible();
  if (petWasVisible) petWindow.hide();
  const restorePetWindow = () => {
    if (petWasVisible && petWindow && !petWindow.isDestroyed() && store.get('petVisible', true)) {
      petWindow.showInactive();
    }
  };

  let remaining = store.get('overlaySeconds', 10);
  let dismissed = false;
  let readyForBlurClose = false;

  const finish = (reason) => {
    if (dismissed) return;
    dismissed = true;
    clearInterval(countdownHandle);
    pushHistory({ type: kind, firedAt: new Date().toISOString(), dismissed: reason });
    if (overlayWindow) {
      overlayWindow.close();
    }
  };

  overlayWindow.webContents.once('did-finish-load', () => {
    overlayWindow.focus();
    overlayWindow.webContents.send('overlay:open', { seconds: remaining });
    readyForBlurClose = true;
  });

  const countdownHandle = setInterval(() => {
    remaining -= 1;
    if (overlayWindow) overlayWindow.webContents.send('overlay:countdown', { remaining });
    if (remaining <= 0) finish('timeout');
  }, 1000);

  const dismissListener = (_e, payload) => finish(payload?.reason || 'esc');
  ipcMain.on('overlay:dismiss', dismissListener);

  const escHandler = () => finish('esc');
  globalShortcut.register('Escape', escHandler);

  overlayWindow.on('blur', () => {
    if (readyForBlurClose) finish('esc');
  });
  overlayWindow.on('closed', () => {
    clearInterval(countdownHandle);
    ipcMain.removeListener('overlay:dismiss', dismissListener);
    globalShortcut.unregister('Escape');
    overlayWindow = null;
    restorePetWindow();
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// Relaunch the app in place. app.exit() skips 'before-quit', so tear down the
// tray, timers, and any global shortcut by hand — otherwise Windows can leave a
// ghost tray icon behind and Escape stays captured from an open overlay.
function restartApp() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  globalShortcut.unregisterAll();
  stopFocusWatcher();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (app.isPackaged) {
    app.relaunch();
  } else {
    // Running from source (`electron .`): argv is a relative ".", so relaunch
    // with an absolute app path instead of depending on the working directory.
    app.relaunch({ args: [app.getAppPath()] });
  }
  app.exit(0);
}

// ---------------------------------------------------------------------------
// Focus sessions (body doubling)
//
// The pal sits and works alongside you for focusSessionMin, then stands up and
// stretches with you for focusBreakMin, and repeats until stopped. Water and
// stretch reminders are paused for the duration — an uninterrupted work block
// is the whole point — and resume when the session ends.
// ---------------------------------------------------------------------------
const BREAK_BUBBLES = [
  'Break time — stretch!',
  'Nice work. Stand up?',
  'Rest your eyes a sec.',
];

let focusPhaseTimer = null;

function defaultWorkSpot() {
  const b = roamBounds();
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

function workSpot() {
  const s = store.get('workSpot', null);
  if (!s || typeof s.x !== 'number' || typeof s.y !== 'number') return defaultWorkSpot();
  const b = roamBounds();
  return {
    x: Math.min(Math.max(s.x, b.minX), b.maxX),
    y: Math.min(Math.max(s.y, b.minY), b.maxY),
  };
}

function clearFocusPhaseTimer() {
  if (focusPhaseTimer) {
    clearTimeout(focusPhaseTimer);
    focusPhaseTimer = null;
  }
}

function beginWorkPhase() {
  clearFocusPhaseTimer();
  pal.startWork(workSpot());
  const mins = store.get('focusSessionMin', 25);
  focusPhaseTimer = setTimeout(() => {
    focusPhaseTimer = null;
    if (!pal.focusActive) return;
    const text = BREAK_BUBBLES[Math.floor(Math.random() * BREAK_BUBBLES.length)];
    // Break length is driven by breakComplete, not this bubble duration.
    pal.startBreak(text, store.get('focusBreakMin', 5) * 60 * 1000);
  }, mins * 60 * 1000);
}

function startFocusSession() {
  if (pal.focusActive) return;
  timers.pauseAll();
  beginWorkPhase();
  if (tray) tray._rebuild();
}

function stopFocusSession({ fromPal = false } = {}) {
  clearFocusPhaseTimer();
  if (!fromPal) pal.stopWork();
  // Only resume reminders if the pal isn't asleep — sleeping keeps them paused.
  if (pal.state !== 'SLEEPING') timers.resumeAll();
  if (tray) tray._rebuild();
}

function buildHouseMenu() {
  const isSleeping = pal.state === 'SLEEPING';
  const template = isSleeping
    ? [
        { label: 'Wake up', click: () => pal.requestWake() },
        { label: 'Settings…', click: createSettingsWindow },
      ]
    : [
        { label: 'Go to sleep', click: () => pal.requestSleep() },
        { label: 'Settings…', click: createSettingsWindow },
      ];
  template.push({ type: 'separator' }, { label: `Restart ${palName()}`, click: restartApp });
  return Menu.buildFromTemplate(template);
}

function buildPalMenu() {
  const isSleeping = pal.state === 'SLEEPING';
  const template = isSleeping
    ? [
        { label: 'Wake up', click: () => pal.requestWake() },
        { label: 'Settings…', click: createSettingsWindow },
      ]
    : [
        pal.focusActive
          ? { label: 'Stop focus session', click: () => stopFocusSession() }
          : { label: 'Start focus session', click: () => startFocusSession() },
        { type: 'separator' },
        { label: 'Drink now', click: () => pal.requestReminder('water') },
        { label: 'Stretch now', click: () => pal.requestReminder('stretch') },
        { type: 'separator' },
        { label: 'Go to sleep', click: () => pal.requestSleep() },
        { label: 'Settings…', click: createSettingsWindow },
      ];
  template.push({ type: 'separator' }, { label: `Restart ${palName()}`, click: restartApp });
  return Menu.buildFromTemplate(template);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: pal.state === 'SLEEPING' ? `Wake ${palName()}` : `Send ${palName()} home`,
        click: () => (pal.state === 'SLEEPING' ? pal.requestWake() : pal.requestSleep()),
      },
      {
        label: store.get('petVisible', true) ? `Hide ${palName()}` : `Show ${palName()}`,
        click: () => {
          const visible = !store.get('petVisible', true);
          store.set('petVisible', visible);
          if (petWindow) visible ? petWindow.showInactive() : petWindow.hide();
        },
      },
      { type: 'separator' },
      pal.focusActive
        ? { label: 'Stop focus session', click: () => stopFocusSession() }
        : { label: 'Start focus session', click: () => startFocusSession() },
      { label: 'Drink now', click: () => pal.requestReminder('water') },
      { label: 'Stretch now', click: () => pal.requestReminder('stretch') },
      { type: 'separator' },
      { label: 'Settings…', click: createSettingsWindow },
      { label: `Restart ${palName()}`, click: restartApp },
      { label: 'Quit', click: () => app.exit(0) },
    ]));
  };
  tray.setToolTip(palName());
  rebuild();
  tray._rebuild = rebuild;
}

// ---------------------------------------------------------------------------
// Focus-aware moods
//
// Reads ONLY the foreground window's process name (e.g. "chrome"), never the
// window title, so document names, URLs, and email subjects are never seen.
// The name is used to pick a reaction pose and is not stored or transmitted.
//
// One long-lived PowerShell process is used rather than spawning one per poll
// (a spawn every few seconds is real battery drain on a laptop) and rather than
// a native module (keeps `npm install` free of a compile step).
// ---------------------------------------------------------------------------
const FOCUS_POLL_MS = 4000;
// Don't react more than once per this window, so heavy alt-tabbing isn't spammy.
const FOCUS_REACTION_COOLDOWN_MS = 45000;

const MOOD_BY_APP = {
  chrome: 'phone', msedge: 'phone', firefox: 'phone', brave: 'phone', opera: 'phone', arc: 'phone',
  code: 'crossed', cursor: 'crossed', devenv: 'crossed', idea64: 'crossed', pycharm64: 'crossed',
  webstorm64: 'crossed', sublime_text: 'crossed', 'notepad++': 'crossed',
  windowsterminal: 'crossed', powershell: 'crossed', pwsh: 'crossed', cmd: 'crossed', wt: 'crossed',
  slack: 'wave', teams: 'wave', discord: 'wave', zoom: 'wave', outlook: 'wave',
  spotify: 'dance', vlc: 'dance', mpc: 'dance', musicbee: 'dance',
  explorer: 'point', notepad: 'point',
};

let focusProc = null;
let focusPollHandle = null;
let focusPending = false;
let lastFocusApp = null;
let lastReactionAt = 0;

const FOCUS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
}
"@
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $procId = 0
  [void][FgWin]::GetWindowThreadProcessId([FgWin]::GetForegroundWindow(), [ref]$procId)
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p) { Write-Output $p.ProcessName } else { Write-Output "" }
}
`;

function handleFocusApp(app) {
  const name = (app || '').trim().toLowerCase();
  if (!name || name === lastFocusApp) return;
  const previous = lastFocusApp;
  lastFocusApp = name;
  // Never react to the very first sample — that's just startup, not a switch.
  if (previous === null) return;

  const mood = MOOD_BY_APP[name];
  if (!mood) return;
  const now = Date.now();
  if (now - lastReactionAt < FOCUS_REACTION_COOLDOWN_MS) return;
  if (pal.playOneShot(mood, 1600)) lastReactionAt = now;
}

function startFocusWatcher() {
  if (focusProc) return;
  const { spawn } = require('child_process');
  try {
    focusProc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(FOCUS_PS, 'utf16le').toString('base64'),
    ], { windowsHide: true });
  } catch {
    focusProc = null;
    return;
  }

  focusProc.stdout.setEncoding('utf8');
  let buffer = '';
  focusProc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      focusPending = false;
      handleFocusApp(line);
    }
  });
  // A dead helper must not take the app down with it — just stop reacting.
  focusProc.on('error', stopFocusWatcher);
  focusProc.on('exit', () => { focusProc = null; focusPending = false; });

  let pendingSince = 0;
  focusPollHandle = setInterval(() => {
    if (!focusProc) return;
    if (focusPending) {
      // A wedged helper would otherwise leave focusPending stuck forever and
      // silently stop all future polling. Give up on the outstanding answer.
      if (Date.now() - pendingSince > FOCUS_POLL_MS * 3) focusPending = false;
      return;
    }
    focusPending = true;
    pendingSince = Date.now();
    try {
      focusProc.stdin.write('\n');
    } catch {
      stopFocusWatcher();
    }
  }, FOCUS_POLL_MS);
}

function stopFocusWatcher() {
  if (focusPollHandle) {
    clearInterval(focusPollHandle);
    focusPollHandle = null;
  }
  if (focusProc) {
    try { focusProc.kill(); } catch { /* already gone */ }
    focusProc = null;
  }
  focusPending = false;
  lastFocusApp = null;
}

// Cursor-follow tracking. A few px of tolerance keeps hardware jitter from
// reading as movement and stopping the pal from ever settling into a sit.
const CURSOR_MOVE_THRESHOLD_PX = 4;
const CURSOR_IDLE_MS = 3000;
let lastCursorPoint = null;
let cursorIdleMs = 0;

function pollCursor() {
  const point = screen.getCursorScreenPoint();
  const moved = !lastCursorPoint
    || Math.abs(point.x - lastCursorPoint.x) > CURSOR_MOVE_THRESHOLD_PX
    || Math.abs(point.y - lastCursorPoint.y) > CURSOR_MOVE_THRESHOLD_PX;
  cursorIdleMs = moved ? 0 : cursorIdleMs + TICK_MS;
  lastCursorPoint = point;

  // Center the pal on the cursor. State clamps to the roam bounds, so a cursor
  // on another monitor can't pull the pal off-screen.
  pal.updateCursor(point.x - PAL_W / 2, point.y - PAL_H / 2, cursorIdleMs >= CURSOR_IDLE_MS);
}

function startTickLoop() {
  let lastPersistedState = null;
  tickHandle = setInterval(() => {
    if (store.get('followCursor', false)) pollCursor();

    pal.tick(TICK_MS);
    if (petWindow && !petWindow.isDestroyed()) {
      const s = pal.serialize();
      // Screen coords -> window-relative coords for the renderer.
      s.x -= workArea.x;
      s.y -= workArea.y;
      const h = housePosition();
      s.houseX = h.x - workArea.x;
      s.houseY = h.y - workArea.y;
      petWindow.webContents.send('pal:state', s);
    }
    // electron-store writes to disk synchronously on every set — only persist
    // when the state actually changes, not 60x a second.
    if (pal.state !== lastPersistedState) {
      lastPersistedState = pal.state;
      store.set('lastState', pal.state);
    }
  }, TICK_MS);
}

function wireIpc() {
  ipcMain.on('hover:enter', () => {
    if (petWindow) petWindow.setIgnoreMouseEvents(false);
  });
  ipcMain.on('hover:leave', () => {
    if (petWindow) petWindow.setIgnoreMouseEvents(true, { forward: true });
  });
  // Drag. If the cursor leaves the pet window mid-drag the renderer stops
  // sending updates and may never deliver a mouseup, so a watchdog puts the pal
  // down rather than leaving it stuck in DRAGGED forever.
  let dragWatchdog = null;
  const clearDragWatchdog = () => {
    if (dragWatchdog) {
      clearTimeout(dragWatchdog);
      dragWatchdog = null;
    }
  };
  // The renderer sends a heartbeat while a drag is held, so silence here means
  // the renderer genuinely stopped (cursor left the window, window closed) —
  // not merely that the user is holding the pal still.
  const armDragWatchdog = () => {
    clearDragWatchdog();
    dragWatchdog = setTimeout(() => {
      dragWatchdog = null;
      pal.endDrag();
      commitHousePos();
    }, 2000);
  };

  ipcMain.on('pal:dragstart', () => {
    if (pal.beginDrag()) armDragWatchdog();
  });
  ipcMain.on('pal:drag', (_e, { x, y }) => {
    if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) return;
    pal.dragTo(x + workArea.x, y + workArea.y);
    armDragWatchdog();
  });
  ipcMain.on('pal:dragend', () => {
    clearDragWatchdog();
    pal.endDrag();
  });

  // House dragging. The house has no state machine of its own — its position is
  // just config, so it's persisted on drop and the pal's door target follows it.
  ipcMain.on('house:drag', (_e, { x, y }) => {
    if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) return;
    liveHousePos = {
      x: Math.min(Math.max(x + workArea.x, workArea.x), workArea.x + workArea.width - HOUSE_W),
      y: Math.min(Math.max(y + workArea.y, workArea.y), workArea.y + workArea.height - HOUSE_H),
    };
    pal.setBounds(roamBounds(), houseDoor());
    // If the pal is walking home, retarget it at the house's new doorway.
    if (pal.state === 'GOING_HOME') {
      const door = houseDoor();
      pal.targetX = door.x;
      pal.targetY = door.y;
    }
    armDragWatchdog();
  });
  ipcMain.on('house:dragend', () => {
    clearDragWatchdog();
    commitHousePos();
  });

  ipcMain.on('pal:click', (_e, { button, target }) => {
    if (target === 'house' && button === 'right') {
      buildHouseMenu().popup({ window: petWindow });
    } else if (target === 'pal' && button === 'right') {
      buildPalMenu().popup({ window: petWindow });
    } else if (target === 'pal' && button === 'left') {
      pal.wave();
    }
  });
  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:set', (_e, patch) => {
    const cfg = setConfig(patch);
    if (typeof patch.stretchIntervalMin === 'number' || typeof patch.waterIntervalMin === 'number') {
      timers.setIntervals(cfg);
    }
    if (typeof patch.startWithWindows === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: patch.startWithWindows });
    }
    if (typeof patch.followCursor === 'boolean') {
      lastCursorPoint = null;
      cursorIdleMs = 0;
      pal.setFollow(patch.followCursor);
    }
    if (typeof patch.focusMoods === 'boolean') {
      patch.focusMoods ? startFocusWatcher() : stopFocusWatcher();
    }
    if (typeof patch.palName === 'string' && tray) {
      tray.setToolTip(palName());
      tray._rebuild();
    }
    if (petWindow) petWindow.webContents.send('config:update', cfg);
    return cfg;
  });
}

function initPal() {
  const cfg = getConfig();
  const bounds = roamBounds();
  pal = new PalState({
    bounds,
    houseDoor: houseDoor(),
    startX: (bounds.minX + bounds.maxX) / 2,
    startY: (bounds.minY + bounds.maxY) / 2,
    walkSpeed: cfg.walkSpeed,
    bubbleMs: cfg.bubbleMs,
  });
  pal.setFollow(!!cfg.followCursor);
  if (cfg.focusMoods) startFocusWatcher();

  pal.on('reminderComplete', (kind) => {
    if (kind === 'water') openOverlay('water');
    else pushHistory({ type: 'stretch', firedAt: new Date().toISOString(), dismissed: 'timeout' });
  });
  // Break finished -> straight back into the next work block.
  pal.on('breakComplete', () => {
    if (pal.focusActive) beginWorkPhase();
  });
  // The pal ended the session itself (e.g. sent to bed mid-session).
  pal.on('focusStopped', () => stopFocusSession({ fromPal: true }));
  pal.on('workSpotMoved', (spot) => store.set('workSpot', spot));

  pal.on('sleeping', () => {
    timers.pauseAll();
    if (tray) tray._rebuild();
  });
  pal.on('awake', () => {
    timers.resumeAll();
    if (tray) tray._rebuild();
  });
}

function initTimers() {
  const cfg = getConfig();
  timers = new ReminderTimers({
    stretchIntervalMin: cfg.stretchIntervalMin,
    waterIntervalMin: cfg.waterIntervalMin,
    onStretch: () => pal.requestReminder('stretch'),
    onWater: () => pal.requestReminder('water'),
  });
  timers.start();
}

function checkQuietHours() {
  const cfg = getConfig();
  if (!cfg.quietHours?.enabled) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const { start, end } = cfg.quietHours;
  const inQuiet = start <= end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
  if (inQuiet && pal.state !== 'SLEEPING' && pal.state !== 'GOING_HOME' && pal.state !== 'ENTERING_HOUSE') {
    pal.requestSleep();
  } else if (!inQuiet && pal.state === 'SLEEPING') {
    pal.requestWake();
  }
}

function checkRequiredAssets() {
  const required = [
    path.join(__dirname, 'assets', 'tray.png'),
    path.join(__dirname, 'assets', 'pal', 'stand_01.png'),
    path.join(__dirname, 'assets', 'pal', 'manifest.json'),
  ];
  const missing = required.filter((p) => !fs.existsSync(p));
  if (missing.length === 0) return true;
  dialog.showErrorBox(
    'MiniMe — assets missing',
    `Missing:\n${missing.join('\n')}\n\nRun these first:\n  npm run slice\n  npm run placeholders`
  );
  return false;
}

app.whenReady().then(() => {
  if (!checkRequiredAssets()) {
    app.exit(1);
    return;
  }
  workArea = computeWorkArea();
  initPal();
  initTimers();
  wireIpc();
  createTray();
  createPetWindow();
  startTickLoop();
  setInterval(checkQuietHours, 60 * 1000);

  screen.on('display-metrics-changed', () => {
    workArea = computeWorkArea();
    pal.setBounds(roamBounds(), houseDoor());
    if (petWindow) {
      petWindow.setBounds(petWindowBounds());
    }
  });
});

app.on('window-all-closed', () => {
  // Never quit on window close — tray keeps the app alive.
});

app.on('before-quit', () => {
  if (tickHandle) clearInterval(tickHandle);
  stopFocusWatcher();
});

// Tray "Quit" calls app.exit(), which skips 'before-quit' — make sure the
// PowerShell helper is never orphaned.
app.on('will-quit', stopFocusWatcher);
process.on('exit', stopFocusWatcher);
