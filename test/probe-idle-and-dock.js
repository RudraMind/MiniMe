// Machine probe. Two questions the headless harnesses cannot answer: does
// powerMonitor.getSystemIdleTime() actually work in an accessory app with no
// permissions granted, and does dock.js read this machine's Dock correctly?
//
// Needs Electron, so run it with `npx electron test/probe-idle-and-dock.js`.
// Diagnostic, not an assertion — read the output.
const { app, screen, powerMonitor } = require('electron');
const dock = require('../dock.js');

app.whenReady().then(async () => {
  if (app.dock) app.dock.hide(); // same accessory demotion the real app does
  const info = await dock.refresh();
  console.log('dock.read() ->', JSON.stringify(info));

  const d = screen.getPrimaryDisplay();
  console.log('bounds  ', JSON.stringify(d.bounds));
  console.log('workArea', JSON.stringify(d.workArea));

  let n = 0;
  const t = setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime();
    const p = screen.getCursorScreenPoint();
    const b = d.bounds;
    const near = info && (info.edge === 'left' ? p.x <= b.x + 40
      : info.edge === 'right' ? p.x >= b.x + b.width - 40
      : p.y >= b.y + b.height - 40);
    console.log(`idle=${idle}s  cursor=(${p.x},${p.y})  atDock=${near}  state=${powerMonitor.getSystemIdleState(60)}`);
    if (++n >= 12) { clearInterval(t); app.exit(0); }
  }, 1000);
});
