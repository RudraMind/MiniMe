// Machine probe. Answers one question: does Electron's screen API reveal where the
// macOS Dock is, without native code? (It does not when the Dock auto-hides —
// which is why dock.js exists.)
//
// Needs Electron: `npx electron test/probe-screen-insets.js`. Diagnostic, not an
// assertion — read the output.
const { app, screen } = require('electron');

function describe(d, i) {
  const b = d.bounds, w = d.workArea;
  // Inset on each edge = how much workArea is pulled in from bounds.
  const inset = {
    left: w.x - b.x,
    top: w.y - b.y,
    right: (b.x + b.width) - (w.x + w.width),
    bottom: (b.y + b.height) - (w.y + w.height),
  };
  const edges = Object.entries(inset).filter(([, v]) => v > 0);
  console.log(`\n--- display ${i}${d.id === screen.getPrimaryDisplay().id ? ' (PRIMARY)' : ''} id=${d.id} ---`);
  console.log(`  scaleFactor : ${d.scaleFactor}`);
  console.log(`  bounds      : x=${b.x} y=${b.y} w=${b.width} h=${b.height}`);
  console.log(`  workArea    : x=${w.x} y=${w.y} w=${w.width} h=${w.height}`);
  console.log(`  insets      : left=${inset.left} top=${inset.top} right=${inset.right} bottom=${inset.bottom}`);
  console.log(`  non-zero    : ${edges.length ? edges.map(([k, v]) => `${k}=${v}`).join(', ') : 'NONE'}`);
  // top inset on macOS is the menu bar, which is always there. Any OTHER edge
  // with an inset is the Dock.
  const dockEdges = edges.filter(([k]) => k !== 'top');
  if (dockEdges.length === 1) {
    const [edge, px] = dockEdges[0];
    console.log(`  => DOCK detected on ${edge.toUpperCase()} edge, ${px}px thick`);
  } else if (!dockEdges.length) {
    console.log('  => NO dock inset (auto-hide on, or dock on another display)');
  } else {
    console.log(`  => AMBIGUOUS: ${dockEdges.length} non-top insets`);
  }
}

app.whenReady().then(() => {
  console.log(`electron ${process.versions.electron}  chrome ${process.versions.chrome}`);
  screen.getAllDisplays().forEach(describe);

  console.log('\n=== watching for display-metrics-changed for 25s ===');
  console.log('Move the Dock (System Settings > Desktop & Dock > Position)');
  console.log('or toggle "Automatically hide and show the Dock" now.\n');
  screen.on('display-metrics-changed', (_e, d, changed) => {
    console.log(`[event] display-metrics-changed  changed=[${changed.join(',')}]`);
    describe(d, 'changed');
  });
  setTimeout(() => { console.log('\ndone.'); app.exit(0); }, 25000);
});
