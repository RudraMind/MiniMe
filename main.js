'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, globalShortcut, nativeImage, dialog, powerMonitor } = require('electron');
const Store = require('electron-store');
const { PalState, HOUSE, BOREDOM_RUNGS } = require('./state');
const { ReminderTimers } = require('./timers');
const dock = require('./dock');

// Must match the size the slicer writes (tools/slice-house.js OUT_W) and the
// values in renderer/chotu.js. The art is square.
const HOUSE_W = 120;
const HOUSE_H = 120;
const PAL_W = 72;
const PAL_H = 72;
const TICK_MS = 16;

// Platform branches are kept inline rather than in a separate module: there are
// only a handful, and each one reads better next to the Windows behaviour it
// diverges from.
const IS_MAC = process.platform === 'darwin';

const store = new Store({
  defaults: {
    stretchIntervalMin: 60,
    waterIntervalMin: 45,
    overlaySeconds: 10,
    bubbleMs: 8000,
    walkSpeed: 1.4,
    startWithWindows: false,
    quietHours: { enabled: false, start: '22:00', end: '07:00' },
    chotuVisible: true,
    lastState: 'IDLE',
    shirtColor: 'default',
    pantColor: 'default',
    // null = park the house in the default top-right corner; once dragged, this
    // holds { x, y } in screen coordinates.
    housePos: null,
    followCursor: false,
    focusMoods: false,
    // Escalating boredom: fidget, sulk, patrol the Dock, doze off.
    boredomLadder: true,
    // The Dock patrol on its own, since it's the rung that walks him a long way
    // and the only one that is macOS-only.
    dockTrip: true,
    character: 'raj', // 'raj' | 'hanu'
    palName: 'Chotu',
    focusSessionMin: 25,
    focusBreakMin: 5,
    // Where the pal sits during a focus session; null = center of the screen.
    workSpot: null,
    history: [],
  },
});

// Carry over the pre-rename key so an existing install keeps its hide/show
// choice instead of silently reverting to visible.
if (store.has('petVisible') && !store.has('chotuVisible')) {
  store.set('chotuVisible', store.get('petVisible'));
  store.delete('petVisible');
}

let chotuWindow = null;
let overlayWindow = null;
let settingsWindow = null;
let tray = null;
let pal = null;
let timers = null;
let tickHandle = null;
let workArea = null;
let displayBounds = null;

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

// Character metadata the MAIN process needs (behaviour). The art tables live in
// renderer/animations.js — every flourish name here must exist there, or it
// silently falls back to the idle pose.
const CHARACTERS = {
  raj: {
    label: 'Raj',
    defaultName: 'Chotu',
    flourishes: { phone: 3, crossed: 3, splash: 2, thumbsup: 2, glasses: 2, dance: 1, jump: 1, sit: 2 },
  },
  hanu: {
    label: 'Hanu',
    defaultName: 'Hanu',
    flourishes: { sit: 3, wave: 2, jump: 1 },
    // Hanu has no phone/arms-crossed/dance art, so app reactions are mapped
    // onto poses he does have. Without this they'd resolve to idle and the
    // reaction would be invisible.
    moods: { phone: 'sit', crossed: 'sit', wave: 'wave', dance: 'jump', point: 'wave' },
  },
  boy: {
    label: 'Boy',
    defaultName: 'Bud',
    flourishes: { sit: 3, wave: 2, jump: 2, stretch: 1 },
    moods: { phone: 'sit', crossed: 'stretch', wave: 'wave', dance: 'jump', point: 'wave' },
  },
  girl: {
    label: 'Girl',
    defaultName: 'Pip',
    flourishes: { sit: 3, wave: 2, jump: 2, stretch: 1 },
    moods: { phone: 'sit', crossed: 'stretch', wave: 'wave', dance: 'jump', point: 'wave' },
  },
  dog: {
    label: 'Dog',
    defaultName: 'Scout',
    flourishes: { sit: 2, wave: 2, lie: 2, play: 4 },
    moods: { phone: 'lie', crossed: 'sit', wave: 'wave', dance: 'run', point: 'wave' },
  },
};
const DEFAULT_CHARACTER = 'raj';

function characterKey() {
  const k = store.get('character', DEFAULT_CHARACTER);
  return CHARACTERS[k] ? k : DEFAULT_CHARACTER;
}

function character() {
  return CHARACTERS[characterKey()];
}

function palName() {
  const n = store.get('palName', '');
  return (typeof n === 'string' && n.trim()) ? n.trim() : character().defaultName;
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
  const d = screen.getPrimaryDisplay();
  // Cached alongside the work area because the Dock check below needs the full
  // display, including the strip the work area excludes — and it runs every
  // tick, so it must not call into the screen API itself.
  displayBounds = d.bounds;
  return d.workArea;
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

// Best-effort IPC to a renderer. During teardown a window can report itself
// alive while its render frame is already gone, so isDestroyed() alone isn't
// enough — Electron throws "Render frame was disposed" from send().
function sendTo(win, channel, payload) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  try {
    win.webContents.send(channel, payload);
  } catch {
    // Window is going away mid-send; nothing to do.
  }
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

// The Chotu window now covers the entire work area so the pal can walk anywhere.
// It stays click-through except while the cursor is over the pal or the house.
function chotuWindowBounds() {
  return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
}

function createChotuWindow() {
  const bounds = chotuWindowBounds();
  chotuWindow = new BrowserWindow({
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
  chotuWindow.setAlwaysOnTop(true, 'screen-saver');
  chotuWindow.setIgnoreMouseEvents(true, { forward: true });
  // macOS has Spaces; without this the pal only exists on the desktop it was
  // created on and vanishes the moment you switch or enter a fullscreen app.
  // skipTransformProcessType is required, not cosmetic: the default path flips
  // the process between accessory and foreground and hides the window each time
  // it is called, which flickers the pal on a dock-hidden app like this one.
  if (IS_MAC) {
    chotuWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
  chotuWindow.loadFile(path.join(__dirname, 'renderer', 'chotu.html'));
  // This window is only ever closed when the app is shutting down (Hide uses
  // hide(), not close()). Stop the tick immediately so it can't keep pushing
  // state into a render frame that is already being torn down — Electron logs
  // "Render frame was disposed" internally for that, which try/catch can't stop.
  chotuWindow.on('close', () => {
    if (tickHandle) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  });
  chotuWindow.on('closed', () => { chotuWindow = null; });
}

// The water overlay is a full-screen dimmer that lives for ~10 seconds.
//
// On Windows `fullscreen: true` is exactly right. On macOS it is the wrong
// primitive: it requests *native* fullscreen, which animates the window into a
// Space of its own over roughly a second and interferes with transparency — a
// heavyweight desk-clearing transition for a brief dimmer. Sizing the window to
// the display instead gives the same effect instantly, and the 'screen-saver'
// window level already draws above the menu bar and Dock.
function overlayWindowOptions() {
  const base = {
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
  };
  if (!IS_MAC) return { ...base, fullscreen: true };
  // Primary display, matching the pal's own roam area (see computeWorkArea);
  // deliberately display.bounds and not workArea, so the menu bar dims too.
  return { ...base, ...screen.getPrimaryDisplay().bounds, movable: false, hasShadow: false };
}

function openOverlay(kind) {
  if (overlayWindow) return;
  overlayWindow = new BrowserWindow(overlayWindowOptions());
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  if (IS_MAC) {
    overlayWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  // The Chotu window is now full-screen and also at 'screen-saver' level, so
  // z-order between the two isn't guaranteed — the pal could wander across the
  // overlay. Hide it for the duration; the overlay renders its own pal.
  const chotuWasVisible = chotuWindow && !chotuWindow.isDestroyed() && chotuWindow.isVisible();
  if (chotuWasVisible) chotuWindow.hide();
  const restoreChotuWindow = () => {
    if (chotuWasVisible && chotuWindow && !chotuWindow.isDestroyed() && store.get('chotuVisible', true)) {
      chotuWindow.showInactive();
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
    // The overlay can be dismissed before it finishes loading, in which case
    // this fires with the window already gone.
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    // Hiding the Dock icon makes this an accessory app, and accessory apps
    // cannot bring themselves forward with focus() alone. Without this the
    // overlay draws on top but never receives the Escape keypress.
    if (IS_MAC) app.focus({ steal: true });
    overlayWindow.focus();
    sendTo(overlayWindow, 'overlay:open', { seconds: remaining });
    readyForBlurClose = true;
  });

  const countdownHandle = setInterval(() => {
    remaining -= 1;
    sendTo(overlayWindow, 'overlay:countdown', { remaining });
    if (remaining <= 0) finish('timeout');
  }, 1000);

  const dismissListener = (_e, payload) => finish(payload?.reason || 'esc');
  ipcMain.on('overlay:dismiss', dismissListener);

  const escHandler = () => finish('esc');
  // Windows needs a global grab because the overlay can sit unfocused behind a
  // foreground app. On macOS the overlay is explicitly focused above, so its own
  // renderer keydown handles Escape — and a *system-wide* Escape grab there
  // would swallow the key for every other app while the overlay is up.
  if (!IS_MAC) globalShortcut.register('Escape', escHandler);

  overlayWindow.on('blur', () => {
    if (readyForBlurClose) finish('esc');
  });
  overlayWindow.on('closed', () => {
    clearInterval(countdownHandle);
    ipcMain.removeListener('overlay:dismiss', dismissListener);
    if (!IS_MAC) globalShortcut.unregister('Escape');
    overlayWindow = null;
    restoreChotuWindow();
  });
}

function createSettingsWindow() {
  // Accessory apps (Dock icon hidden) can't raise their own windows without
  // stealing activation first, so Settings would otherwise open behind
  // whatever you were working in.
  if (IS_MAC) app.focus({ steal: true });
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

// Translate an app-reaction pose onto something the active character can
// actually perform (see the `moods` maps above).
function moodFor(mood) {
  const map = character().moods;
  if (!map) return mood;
  return map[mood] || 'wave';
}

function setCharacter(key) {
  if (!CHARACTERS[key] || key === characterKey()) return;
  store.set('character', key);
  // The name follows the character, so menus don't read "Send Chotu home"
  // while Hanu is on screen. It stays editable in Settings afterwards.
  store.set('palName', CHARACTERS[key].defaultName);
  pal.cfg.flourishes = CHARACTERS[key].flourishes;
  if (tray) {
    tray.setToolTip(palName());
    tray._rebuild();
  }
  sendTo(chotuWindow, 'config:update', getConfig());
}

// A submenu rather than a toggle, now that there are more than two.
function switchCharacterItem() {
  const active = characterKey();
  return {
    label: 'Character',
    submenu: Object.entries(CHARACTERS).map(([key, c]) => ({
      label: c.label,
      type: 'radio',
      checked: key === active,
      click: () => setCharacter(key),
    })),
  };
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
  template.push({ type: 'separator' }, switchCharacterItem(), { label: `Restart ${palName()}`, click: restartApp });
  return Menu.buildFromTemplate(template);
}

// The boredom rungs, as things you can ask for.
//
// Left to itself the ladder takes fifteen minutes to play out and only does so
// when nobody is interacting with the app — which makes it impossible to show
// anyone on purpose, or to check after changing it. Each item does exactly what
// the rung does when it arrives on its own; the wait is the only thing skipped.
//
// Labels carry the real wait so the menu doubles as documentation of the ladder.
const PLAY_LABELS = {
  fidget: 'Fidget',
  sulk: 'Give up on me',
  dock: 'Go look at the Dock',
  doze: 'Doze off',
};

function formatWait(ms) {
  const secs = Math.round(ms / 1000);
  return secs < 60 ? `${secs} sec` : `${Math.round(secs / 60)} min`;
}

function playMenuItem() {
  return {
    label: 'Play',
    submenu: BOREDOM_RUNGS.map((rung) => ({
      label: `${PLAY_LABELS[rung.key] || rung.key} (${formatWait(rung.afterMs)})`,
      // Greyed out rather than missing: the Dock trip is unavailable on Windows
      // and during a focus session, and a menu that changes shape is harder to
      // learn than one where an item is visibly not available right now.
      enabled: pal.canPlayRung(rung.key),
      click: () => pal.playRung(rung.key),
    })),
  };
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
        playMenuItem(),
        { type: 'separator' },
        { label: 'Go to sleep', click: () => pal.requestSleep() },
        { label: 'Settings…', click: createSettingsWindow },
      ];
  template.push({ type: 'separator' }, switchCharacterItem(), { label: `Restart ${palName()}`, click: restartApp });
  return Menu.buildFromTemplate(template);
}

function createTray() {
  // The Windows tray art is 32x32, which the macOS menu bar renders at 32pt —
  // roughly twice the height of every system item. macOS gets a 16pt icon
  // instead; nativeImage picks up the neighbouring tray-mac@2x.png for Retina.
  // Left in colour rather than a template image on purpose: a black silhouette
  // loses the character, and the art is light enough to read in dark mode.
  const iconFile = IS_MAC ? 'tray-mac.png' : 'tray.png';
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', iconFile));
  tray = new Tray(icon);
  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: pal.state === 'SLEEPING' ? `Wake ${palName()}` : `Send ${palName()} home`,
        click: () => (pal.state === 'SLEEPING' ? pal.requestWake() : pal.requestSleep()),
      },
      {
        label: store.get('chotuVisible', true) ? `Hide ${palName()}` : `Show ${palName()}`,
        click: () => {
          const visible = !store.get('chotuVisible', true);
          store.set('chotuVisible', visible);
          if (chotuWindow) visible ? chotuWindow.showInactive() : chotuWindow.hide();
        },
      },
      { type: 'separator' },
      pal.focusActive
        ? { label: 'Stop focus session', click: () => stopFocusSession() }
        : { label: 'Start focus session', click: () => startFocusSession() },
      { label: 'Drink now', click: () => pal.requestReminder('water') },
      { label: 'Stretch now', click: () => pal.requestReminder('stretch') },
      playMenuItem(),
      { type: 'separator' },
      switchCharacterItem(),
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
// One long-lived helper process is used rather than spawning one per poll (a
// spawn every few seconds is real battery drain on a laptop) and rather than a
// native module (keeps `npm install` free of a compile step). Windows uses
// PowerShell with two user32 calls; macOS uses /bin/sh driving lsappinfo, which
// is a Launch Services query and needs no Accessibility or Automation grant —
// AppleScript via System Events would work too but triggers a TCC prompt.
// ---------------------------------------------------------------------------
const FOCUS_POLL_MS = 4000;
// Don't react more than once per this window, so heavy alt-tabbing isn't spammy.
const FOCUS_REACTION_COOLDOWN_MS = 45000;

// Windows reports a bare process name ("msedge"); macOS Launch Services reports
// a display name ("Microsoft Edge"). The keys differ per platform for that
// reason — reusing one table would leave the feature silently inert on macOS.
// Both are matched lowercased (see handleFocusApp).
const MOOD_BY_APP_WIN = {
  chrome: 'phone', msedge: 'phone', firefox: 'phone', brave: 'phone', opera: 'phone', arc: 'phone',
  code: 'crossed', cursor: 'crossed', devenv: 'crossed', idea64: 'crossed', pycharm64: 'crossed',
  webstorm64: 'crossed', sublime_text: 'crossed', 'notepad++': 'crossed',
  windowsterminal: 'crossed', powershell: 'crossed', pwsh: 'crossed', cmd: 'crossed', wt: 'crossed',
  slack: 'wave', teams: 'wave', discord: 'wave', zoom: 'wave', outlook: 'wave',
  spotify: 'dance', vlc: 'dance', mpc: 'dance', musicbee: 'dance',
  explorer: 'point', notepad: 'point',
};

const MOOD_BY_APP_MAC = {
  'google chrome': 'phone', safari: 'phone', firefox: 'phone', 'microsoft edge': 'phone',
  'brave browser': 'phone', arc: 'phone', opera: 'phone',
  code: 'crossed', 'visual studio code': 'crossed', cursor: 'crossed', xcode: 'crossed',
  'intellij idea': 'crossed', pycharm: 'crossed', webstorm: 'crossed', 'sublime text': 'crossed',
  terminal: 'crossed', iterm2: 'crossed', warp: 'crossed', ghostty: 'crossed',
  slack: 'wave', 'microsoft teams': 'wave', discord: 'wave', 'zoom.us': 'wave',
  'microsoft outlook': 'wave', mail: 'wave',
  spotify: 'dance', music: 'dance', vlc: 'dance', iina: 'dance',
  finder: 'point', notes: 'point', textedit: 'point', preview: 'point',
};

const MOOD_BY_APP = IS_MAC ? MOOD_BY_APP_MAC : MOOD_BY_APP_WIN;

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

// macOS counterpart. Blocks on stdin so it costs nothing between polls, and
// always prints exactly one line per ping — including an empty one on failure,
// or the caller's focusPending flag would stay set and stop all future polling.
const FOCUS_SH = `
while IFS= read -r _; do
  name=""
  asn=$(lsappinfo front 2>/dev/null)
  if [ -n "$asn" ]; then
    name=$(lsappinfo info -only name "$asn" 2>/dev/null | sed -n 's/.*"LSDisplayName"="\\([^"]*\\)".*/\\1/p')
  fi
  printf '%s\\n' "$name"
done
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
  if (pal.playOneShot(moodFor(mood), 1600)) lastReactionAt = now;
}

function startFocusWatcher() {
  if (focusProc) return;
  // Only these two platforms have a helper; elsewhere the feature stays off
  // rather than spawning a process that can't exist.
  if (!IS_MAC && process.platform !== 'win32') return;
  const { spawn } = require('child_process');
  try {
    focusProc = IS_MAC
      ? spawn('/bin/sh', ['-c', FOCUS_SH])
      : spawn('powershell.exe', [
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

// Re-read the Dock's preferences. Off macOS dock.read() returns null and the
// pal simply never learns of a Dock, which makes the Dock rung fall through.
const DOCK_REFRESH_MS = 60 * 1000;

function refreshDock() {
  const before = dock.get();
  dock.refresh().then((info) => {
    if (pal) pal.setDock(info);
    // The tray menu is a snapshot, and it only offers the Dock trip when there
    // is a Dock. The first read arrives after the tray is already built.
    if (tray && info && (!before || before.edge !== info.edge)) tray._rebuild();
  }).catch(() => { /* keep the cached value */ });
}

// How close the pointer has to get to the Dock's edge to count as "you came
// over" — roughly a Dock tile, so the hidden Dock will have slid out by then.
const CURSOR_AT_DOCK_PX = 40;
// getSystemIdleTime() has one-second resolution, so reading it 60x a second
// buys nothing.
const IDLE_SAMPLE_TICKS = 16;
let idleSampleCountdown = 0;

// True when the pointer is up against whichever edge the Dock lives on. Used to
// infer that a hidden Dock has revealed itself, which nothing else can tell us.
function cursorNearDock(point) {
  const d = dock.get();
  const b = displayBounds;
  if (!d || !point || !b) return false;
  if (d.edge === 'bottom') return point.y >= b.y + b.height - CURSOR_AT_DOCK_PX;
  if (d.edge === 'left') return point.x <= b.x + CURSOR_AT_DOCK_PX;
  if (d.edge === 'right') return point.x >= b.x + b.width - CURSOR_AT_DOCK_PX;
  return false;
}

// Sampled every tick regardless of the follow-cursor setting: the boredom
// ladder needs the pointer position to know whether you came over to the Dock.
// Only the pal.updateCursor() call — the part that actually makes him chase the
// mouse — stays behind the setting.
function pollCursor(follow) {
  const point = screen.getCursorScreenPoint();
  const moved = !lastCursorPoint
    || Math.abs(point.x - lastCursorPoint.x) > CURSOR_MOVE_THRESHOLD_PX
    || Math.abs(point.y - lastCursorPoint.y) > CURSOR_MOVE_THRESHOLD_PX;
  cursorIdleMs = moved ? 0 : cursorIdleMs + TICK_MS;
  lastCursorPoint = point;

  pal.setCursorAtDock(cursorNearDock(point));

  // Center the pal on the cursor. State clamps to the roam bounds, so a cursor
  // on another monitor can't pull the pal off-screen.
  if (follow) {
    pal.updateCursor(point.x - PAL_W / 2, point.y - PAL_H / 2, cursorIdleMs >= CURSOR_IDLE_MS);
  }
}

// MINIME_DEBUG_LADDER=1 traces every state change with the idle clock and Dock
// beside it. The boredom ladder is the one behaviour that only happens when
// nobody is watching, so without this the only way to check it is to sit
// perfectly still and hope. Silent unless asked for.
const DEBUG_LADDER = process.env.MINIME_DEBUG_LADDER === '1';

// MINIME_DEBUG_FACING=1 prints which way the pal is travelling, which way the
// art faces, and therefore whether the renderer will mirror it. Facing bugs are
// invisible from a still frame — you have to see the direction of travel and the
// sprite's own direction side by side over several ticks. Silent unless asked for.
const DEBUG_FACING = process.env.MINIME_DEBUG_FACING === '1';
let lastFacingTrace = 0;
let lastTraceX = null;
let facingShots = 0;

// Deliberately does NOT read the facing tables. They live in tools/ and
// renderer/, and tools/ is excluded from the packaged build, so reaching for them
// here would log something different in the bundle than it does from source.
// Everything below is what the main process actually owns: where the pal moved and
// which way it told the renderer it is facing. Whether the pixels agree is a
// question for the screenshots, not for a table.
function traceFacing(s) {
  const now = Date.now();
  if (now - lastFacingTrace < 250) return;
  lastFacingTrace = now;
  const travel = lastTraceX === null ? 0 : s.x - lastTraceX;
  lastTraceX = s.x;
  const travelWord = Math.abs(travel) < 0.5 ? 'still' : (travel > 0 ? 'RIGHT' : 'LEFT');
  console.log(`[facing] ${characterKey()} state=${s.state} anim=${s.animation} `
    + `x=${Math.round(s.x)} moved=${travel.toFixed(1)}(${travelWord}) `
    + `facing=${s.facing > 0 ? 'right' : 'left'}`);

  // Photograph the sprite as the screen actually shows it. A facing bug cannot be
  // diagnosed from state alone: the numbers can be right while the pixels are
  // wrong, and the reverse. Cropped to the pal so the shot is small.
  if (facingShots < 24 && chotuWindow && !chotuWindow.isDestroyed()) {
    const n = String(facingShots++).padStart(2, '0');
    const rect = {
      x: Math.max(0, Math.round(s.x) - 8),
      y: Math.max(0, Math.round(s.y) - 8),
      width: PAL_W + 16,
      height: PAL_H + 16,
    };
    chotuWindow.webContents.capturePage(rect)
      .then((img) => fs.writeFileSync(`/tmp/minime-shot-${n}-${travelWord}.png`, img.toPNG()))
      .catch(() => {});
  }
}

function traceState(from, to) {
  const d = dock.get();
  const idle = Math.round(powerMonitor.getSystemIdleTime());
  console.log(`[ladder] ${from} -> ${to}  rung=${pal.bored} anim=${pal.animation} `
    + `idle=${idle}s pos=(${Math.round(pal.x)},${Math.round(pal.y)}) `
    + `dock=${d ? `${d.edge}${d.hidden ? '/hidden' : '/pinned'}` : 'none'}`);
}

function startTickLoop() {
  let lastPersistedState = null;
  tickHandle = setInterval(() => {
    pollCursor(store.get('followCursor', false));

    if (--idleSampleCountdown <= 0) {
      idleSampleCountdown = IDLE_SAMPLE_TICKS;
      // Seconds since the last input anywhere on the system — not just in this
      // app, which never has focus.
      pal.setSystemIdleMs(powerMonitor.getSystemIdleTime() * 1000);
    }

    pal.tick(TICK_MS);

    const s = pal.serialize();
    // Screen coords -> window-relative coords for the renderer.
    s.x -= workArea.x;
    s.y -= workArea.y;
    const h = housePosition();
    s.houseX = h.x - workArea.x;
    s.houseY = h.y - workArea.y;
    if (s.playAnchor) {
      s.playAnchor = { x: s.playAnchor.x - workArea.x, y: s.playAnchor.y - workArea.y };
    }
    sendTo(chotuWindow, 'pal:state', s);
    if (DEBUG_FACING) traceFacing(s);

    // electron-store writes to disk synchronously on every set — only persist
    // when the state actually changes, not 60x a second.
    if (pal.state !== lastPersistedState) {
      if (DEBUG_LADDER) traceState(lastPersistedState, pal.state);
      lastPersistedState = pal.state;
      store.set('lastState', pal.state);
    }
  }, TICK_MS);
}

function wireIpc() {
  ipcMain.on('hover:enter', () => {
    if (chotuWindow) chotuWindow.setIgnoreMouseEvents(false);
  });
  ipcMain.on('hover:leave', () => {
    if (chotuWindow) chotuWindow.setIgnoreMouseEvents(true, { forward: true });
  });
  // Drag. If the cursor leaves the Chotu window mid-drag the renderer stops
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
      buildHouseMenu().popup({ window: chotuWindow });
    } else if (target === 'pal' && button === 'right') {
      buildPalMenu().popup({ window: chotuWindow });
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
    if (typeof patch.boredomLadder === 'boolean') {
      pal.setBoredomEnabled(patch.boredomLadder);
    }
    if (typeof patch.dockTrip === 'boolean') {
      pal.setDockTripEnabled(patch.dockTrip);
    }
    if (typeof patch.character === 'string') {
      // Settings can change the character too; keep the runtime in step with
      // the stored value (menu switching goes through setCharacter()).
      pal.cfg.flourishes = character().flourishes;
      if (tray) {
        tray.setToolTip(palName());
        tray._rebuild();
      }
    }
    if (typeof patch.palName === 'string' && tray) {
      tray.setToolTip(palName());
      tray._rebuild();
    }
    sendTo(chotuWindow, 'config:update', cfg);
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
    flourishes: character().flourishes,
    boredomLadder: cfg.boredomLadder !== false,
    dockTrip: cfg.dockTrip !== false,
  });
  pal.setFollow(!!cfg.followCursor);
  // His chair is the focus-session work spot: one seat, not two.
  pal.setChair(workSpot());
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
  pal.on('workSpotMoved', (spot) => {
    store.set('workSpot', spot);
    pal.setChair(workSpot());
  });

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
    path.join(__dirname, 'assets', IS_MAC ? 'tray-mac.png' : 'tray.png'),
    path.join(__dirname, 'assets', 'pal', 'stand_01.png'),
    path.join(__dirname, 'assets', 'pal', 'manifest.json'),
    path.join(__dirname, 'assets', 'hanu', 'hanu_wave_01.png'),
    path.join(__dirname, 'assets', 'boy', 'boy_wave_01.png'),
    path.join(__dirname, 'assets', 'girl', 'girl_wave_01.png'),
    path.join(__dirname, 'assets', 'dog', 'dog_sit_01.png'),
    path.join(__dirname, 'assets', 'props', 'bone.png'),
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
  // A desktop companion belongs in the menu bar, not the Dock or Cmd-Tab.
  // Windows gets this from skipTaskbar on each window; macOS needs the process
  // itself demoted to an accessory, and it must happen before any window is
  // created. Note this is what makes the app.focus({ steal: true }) calls above
  // necessary — accessory apps cannot raise their own windows otherwise.
  if (IS_MAC && app.dock) app.dock.hide();
  if (!checkRequiredAssets()) {
    app.exit(1);
    return;
  }
  workArea = computeWorkArea();
  initPal();
  initTimers();
  wireIpc();
  createTray();
  createChotuWindow();
  startTickLoop();
  setInterval(checkQuietHours, 60 * 1000);

  // Where the Dock is. `defaults` is a subprocess, so this is read on a slow
  // timer rather than polled: moving the Dock is a rare, deliberate act, and
  // the Dock trip only happens after five minutes of being ignored anyway.
  refreshDock();
  setInterval(refreshDock, DOCK_REFRESH_MS);

  screen.on('display-metrics-changed', () => {
    workArea = computeWorkArea();
    pal.setBounds(roamBounds(), houseDoor());
    // The work spot is clamped to the roam bounds, which just changed.
    pal.setChair(workSpot());
    if (chotuWindow) {
      chotuWindow.setBounds(chotuWindowBounds());
    }
    // Pinning or unpinning the Dock fires this too, and changes `autohide`.
    refreshDock();
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
