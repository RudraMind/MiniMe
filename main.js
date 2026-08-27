'use strict';
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, globalShortcut, nativeImage, dialog } = require('electron');
const Store = require('electron-store');
const { PalState, HOUSE } = require('./state');
const { ReminderTimers } = require('./timers');

const HOUSE_W = 160;
const HOUSE_H = 128;
const PAL_W = 96;
const LANE_H = 140;
const LANE_W = 170; // vertical-mode lane thickness (must fit house's 160px width)
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
    laneOrientation: 'horizontal', // 'horizontal' (top edge) | 'vertical' (right edge)
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
};

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

function isVertical() {
  return store.get('laneOrientation', 'horizontal') === 'vertical';
}

function laneBounds() {
  if (isVertical()) {
    // House at the top of the lane; pal walks down toward the bottom on wake.
    return {
      laneMinX: workArea.y + HOUSE_H + PAL_W,
      laneMaxX: workArea.y + workArea.height - PAL_W,
      houseDoorX: workArea.y + HOUSE_H + PAL_W / 2,
    };
  }
  return {
    laneMinX: workArea.x,
    laneMaxX: workArea.x + workArea.width - HOUSE_W - PAL_W,
    houseDoorX: workArea.x + workArea.width - HOUSE_W - PAL_W / 2,
  };
}

function petWindowBounds() {
  if (isVertical()) {
    return { x: workArea.x + workArea.width - LANE_W, y: workArea.y, width: LANE_W, height: workArea.height };
  }
  return { x: workArea.x, y: workArea.y, width: workArea.width, height: LANE_H };
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
        { label: 'Drink now', click: () => pal.requestReminder('water') },
        { label: 'Stretch now', click: () => pal.requestReminder('stretch') },
        { type: 'separator' },
        { label: 'Go to sleep', click: () => pal.requestSleep() },
        { label: 'Settings…', click: createSettingsWindow },
      ];
  return Menu.buildFromTemplate(template);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: pal.state === 'SLEEPING' ? 'Wake pal' : 'Send home',
        click: () => (pal.state === 'SLEEPING' ? pal.requestWake() : pal.requestSleep()),
      },
      {
        label: store.get('petVisible', true) ? 'Hide pal' : 'Show pal',
        click: () => {
          const visible = !store.get('petVisible', true);
          store.set('petVisible', visible);
          if (petWindow) visible ? petWindow.showInactive() : petWindow.hide();
        },
      },
      { label: 'Drink now', click: () => pal.requestReminder('water') },
      { label: 'Stretch now', click: () => pal.requestReminder('stretch') },
      { type: 'separator' },
      { label: 'Settings…', click: createSettingsWindow },
      { label: 'Quit', click: () => app.exit(0) },
    ]));
  };
  tray.setToolTip('MiniMe');
  rebuild();
  tray._rebuild = rebuild;
}

function startTickLoop() {
  tickHandle = setInterval(() => {
    pal.tick(TICK_MS);
    if (petWindow) {
      const vertical = isVertical();
      const s = pal.serialize();
      s.x = s.x - (vertical ? workArea.y : workArea.x);
      s.orientation = vertical ? 'vertical' : 'horizontal';
      petWindow.webContents.send('pal:state', s);
    }
    store.set('lastState', pal.state);
  }, TICK_MS);
}

function wireIpc() {
  ipcMain.on('hover:enter', () => {
    if (petWindow) petWindow.setIgnoreMouseEvents(false);
  });
  ipcMain.on('hover:leave', () => {
    if (petWindow) petWindow.setIgnoreMouseEvents(true, { forward: true });
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
    const prevOrientation = store.get('laneOrientation', 'horizontal');
    const cfg = setConfig(patch);
    if (typeof patch.stretchIntervalMin === 'number' || typeof patch.waterIntervalMin === 'number') {
      timers.setIntervals(cfg);
    }
    if (typeof patch.startWithWindows === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: patch.startWithWindows });
    }
    if (typeof patch.laneOrientation === 'string' && patch.laneOrientation !== prevOrientation) {
      applyOrientation();
    }
    if (petWindow) petWindow.webContents.send('config:update', cfg);
    return cfg;
  });
}

function initPal() {
  const b = laneBounds();
  const cfg = getConfig();
  pal = new PalState({
    laneMinX: b.laneMinX,
    laneMaxX: b.laneMaxX,
    houseDoorX: b.houseDoorX,
    walkSpeed: cfg.walkSpeed,
    bubbleMs: cfg.bubbleMs,
  });

  pal.on('reminderComplete', (kind) => {
    if (kind === 'water') openOverlay('water');
    else pushHistory({ type: 'stretch', firedAt: new Date().toISOString(), dismissed: 'timeout' });
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

function applyOrientation() {
  const b = laneBounds();
  pal.cfg.laneMinX = b.laneMinX;
  pal.cfg.laneMaxX = b.laneMaxX;
  pal.cfg.houseDoorX = b.houseDoorX;
  pal.state = 'IDLE';
  pal.animation = 'idle';
  pal.targetX = null;
  pal.bubbleText = null;
  pal.houseState = HOUSE.CLOSED;
  pal.x = b.laneMinX;
  if (petWindow) petWindow.setBounds(petWindowBounds());
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
    const b = laneBounds();
    pal.cfg.laneMinX = b.laneMinX;
    pal.cfg.laneMaxX = b.laneMaxX;
    pal.cfg.houseDoorX = b.houseDoorX;
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
});
