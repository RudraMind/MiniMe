'use strict';
// Diagnostic: list every enclosed transparent region in a set of frames, with
// its area, bounding box and the dominant colour around it. Used to pick the
// area threshold for fix-alpha-speckles.js. Not part of the build.
//
// Usage: node tools/inspect-holes.js assets/pal [assets/dog ...]

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CUT = 16;

function outsideMask(alpha, W, H) {
  const seen = new Uint8Array(W * H);
  const st = [];
  const push = (x, y) => {
    const i = y * W + x;
    if (!seen[i] && alpha[i] < CUT) { seen[i] = 1; st.push(i); }
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (st.length) {
    const i = st.pop();
    const x = i % W, y = (i / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  return seen;
}

async function inspect(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const alpha = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = data[i * 4 + 3];
  const out = outsideMask(alpha, W, H);
  const done = new Uint8Array(W * H);
  const rows = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (alpha[i] >= CUT || out[i] || done[i]) continue;
      const px = [];
      const q = [i];
      done[i] = 1;
      while (q.length) {
        const j = q.pop();
        px.push(j);
        const jx = j % W, jy = (j / W) | 0;
        const nb = [];
        if (jx > 0) nb.push(j - 1);
        if (jx < W - 1) nb.push(j + 1);
        if (jy > 0) nb.push(j - W);
        if (jy < H - 1) nb.push(j + W);
        for (const n of nb) if (alpha[n] < CUT && !out[n] && !done[n]) { done[n] = 1; q.push(n); }
      }
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      const set = new Set(px);
      const freq = new Map();
      for (const j of px) {
        const jx = j % W, jy = (j / W) | 0;
        if (jx < x0) x0 = jx; if (jx > x1) x1 = jx;
        if (jy < y0) y0 = jy; if (jy > y1) y1 = jy;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = jx + dx, ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (set.has(n)) continue;
          const o = n * 4;
          if (data[o + 3] < CUT) continue;
          const k = `${data[o]},${data[o + 1]},${data[o + 2]}`;
          freq.set(k, (freq.get(k) || 0) + 1);
        }
      }
      let dom = '-', dn = -1;
      for (const [k, n] of freq) if (n > dn) { dn = n; dom = k; }
      rows.push({ area: px.length, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, dom, H });
    }
  }
  return { W, H, rows };
}

async function main() {
  const dirs = process.argv.slice(2);
  const all = [];
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.png')).sort()) {
      const p = path.join(dir, f);
      const { H, rows } = await inspect(p);
      for (const r of rows) all.push({ file: p, ...r, H });
    }
  }
  all.sort((a, b) => b.area - a.area);
  console.log('area  box(x,y,w,h)      yFrac  domColour        file');
  for (const r of all) {
    const yf = (r.y0 / r.H).toFixed(2);
    console.log(
      String(r.area).padStart(4),
      `(${r.x0},${r.y0},${r.w},${r.h})`.padEnd(16),
      yf.padStart(5),
      r.dom.padEnd(15),
      r.file
    );
  }
  console.log(`\n${all.length} enclosed regions, ${all.reduce((s, r) => s + r.area, 0)}px total`);
}

main().catch((e) => { console.error(e); process.exit(1); });
