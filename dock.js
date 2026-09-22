'use strict';
// Where the macOS Dock is.
//
// Read from the Dock's own preferences rather than inferred from screen
// geometry. Electron's workArea only excludes the Dock when it is *pinned*;
// with auto-hide on — a common setup — bounds and workArea differ by nothing
// but the menu bar, so the geometry carries no Dock information at all.
//
// `defaults` is a subprocess, so this is cached and refreshed on a slow timer.
// Never call read() from the animation tick.

const { execFile } = require('child_process');

const IS_MAC = process.platform === 'darwin';
const EDGES = new Set(['left', 'right', 'bottom']);
// A Dock that has never been moved has no `orientation` key at all.
const DEFAULT_EDGE = 'bottom';
const DEFAULT_TILE = 48;

let cached = null;

function readKey(key) {
  return new Promise((resolve) => {
    execFile('defaults', ['read', 'com.apple.dock', key], { timeout: 2000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim());
    });
  });
}

// Resolves to { edge, hidden, tileSize }, or null off macOS.
//
// Missing keys are treated as macOS defaults rather than as failure: a pristine
// install has neither `orientation` nor `autohide` set, and returning null
// there would disable the feature on exactly the machines where it works best.
async function read() {
  if (!IS_MAC) return null;
  const [edge, autohide, tile] = await Promise.all([
    readKey('orientation'),
    readKey('autohide'),
    readKey('tilesize'),
  ]);
  const size = Number(tile);
  return {
    edge: EDGES.has(edge) ? edge : DEFAULT_EDGE,
    hidden: autohide === '1',
    tileSize: Number.isFinite(size) && size > 0 ? size : DEFAULT_TILE,
  };
}

// Refresh the cache. Keeps the previous value on failure so a transient
// `defaults` hiccup doesn't switch the behaviour off mid-session.
async function refresh() {
  const next = await read();
  if (next) cached = next;
  return cached;
}

function get() {
  return cached;
}

module.exports = { read, refresh, get, IS_MAC };
