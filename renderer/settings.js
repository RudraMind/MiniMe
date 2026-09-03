import { COLOR_SWATCHES } from './recolor.js';

const fields = [
  'stretchIntervalMin', 'waterIntervalMin', 'overlaySeconds', 'bubbleMs', 'walkSpeed',
  'focusSessionMin', 'focusBreakMin',
];
const COLOR_KEYS = ['default', ...Object.keys(COLOR_SWATCHES)];

let shirtColor = 'default';
let pantColor = 'default';

function buildSwatches(containerId, selected, onPick) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  for (const key of COLOR_KEYS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch' + (key === 'default' ? ' default' : '') + (key === selected ? ' selected' : '');
    btn.title = key;
    if (key !== 'default') btn.style.background = COLOR_SWATCHES[key];
    btn.addEventListener('click', () => {
      onPick(key);
      [...container.children].forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
    });
    container.appendChild(btn);
  }
}

async function load() {
  const cfg = await window.pixelpal.invoke('config:get');
  for (const f of fields) document.getElementById(f).value = cfg[f];
  document.getElementById('startWithWindows').checked = !!cfg.startWithWindows;
  document.getElementById('quietEnabled').checked = !!cfg.quietHours?.enabled;
  document.getElementById('quietStart').value = cfg.quietHours?.start || '22:00';
  document.getElementById('quietEnd').value = cfg.quietHours?.end || '07:00';

  shirtColor = cfg.shirtColor || 'default';
  pantColor = cfg.pantColor || 'default';
  buildSwatches('shirtSwatches', shirtColor, (key) => (shirtColor = key));
  buildSwatches('pantSwatches', pantColor, (key) => (pantColor = key));

  document.getElementById('palName').value = cfg.palName || 'Chotu';
  document.getElementById('followCursor').checked = !!cfg.followCursor;
  document.getElementById('focusMoods').checked = !!cfg.focusMoods;
}

document.getElementById('save').addEventListener('click', async () => {
  const patch = {};
  for (const f of fields) patch[f] = Number(document.getElementById(f).value);
  patch.startWithWindows = document.getElementById('startWithWindows').checked;
  patch.quietHours = {
    enabled: document.getElementById('quietEnabled').checked,
    start: document.getElementById('quietStart').value,
    end: document.getElementById('quietEnd').value,
  };
  patch.shirtColor = shirtColor;
  patch.pantColor = pantColor;
  const name = document.getElementById('palName').value.trim();
  patch.palName = name || 'Chotu';
  patch.followCursor = document.getElementById('followCursor').checked;
  patch.focusMoods = document.getElementById('focusMoods').checked;
  await window.pixelpal.invoke('config:set', patch);
  const status = document.getElementById('status');
  status.textContent = 'Saved.';
  setTimeout(() => (status.textContent = ''), 2000);
});

load();
