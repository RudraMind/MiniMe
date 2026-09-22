'use strict';
// Throwaway harness for comparing background-keying rules on spritesheet.png
// without touching assets/pal. Mirrors slice-sheet.js exactly except for the
// backdrop test and the output directory.
//
// Usage: node tools/keying-experiment.js <outDir> <mode> [tolCore] [tolWide] [cast]
//   mode: current | tight | cast

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SHEET = path.join(__dirname, '..', 'assets', 'reference', 'spritesheet.png');
const BG = [23, 29, 38];
const CANVAS = 72;
const NAMES = [
  'walk_01', 'walk_02', 'walk_03', 'walk_04', 'walk_05',
  'wave_01', 'wave_02', 'wave_03',
  'glasses_01', 'glasses_02', 'glasses_03',
  'stand_01',
  'dance_01', 'dance_02', 'dance_03', 'dance_04',
  'drink_01', 'drink_02', 'drink_03',
  'splash_01', 'splash_02', 'splash_03',
  'stretch_01', 'stretch_02', 'stretch_03',
  'thumbsup_01', 'point_01', 'crossed_01', 'phone_01', 'jump_01', 'sit_01',
];

const [outDir, mode, tolCoreA, tolWideA, castA] = process.argv.slice(2);
const TOL_CORE = Number(tolCoreA || 10);
const TOL_WIDE = Number(tolWideA || 40);
const CAST = Number(castA || 6);

function makeTest(mode) {
  const diff = (r, g, b) => Math.abs(r - BG[0]) + Math.abs(g - BG[1]) + Math.abs(b - BG[2]);
  if (mode === 'current') return (r, g, b) => diff(r, g, b) <= TOL_WIDE;
  if (mode === 'tight') return (r, g, b) => diff(r, g, b) <= TOL_CORE;
  // 'cast': the flat backdrop is blue-dominant (b-r = +15); Raj's near-black
  // hair is neutral (b-r = 0..3). So accept anything very close to the
  // backdrop colour, plus anything loosely close that ALSO carries the
  // backdrop's blue cast - that second clause is the antialiased rim where the
  // backdrop blends into dark art, which must go or it leaves a navy halo.
  return (r, g, b) => {
    const d = diff(r, g, b);
    if (d <= TOL_CORE) return true;
    return d <= TOL_WIDE && (b - r) >= CAST;
  };
}

function closeAlpha(opaque, w, h, r) {
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let f = 0;
    for (let dy = -r; dy <= r && !f; dy++) {
      const ny = y + dy; if (ny < 0 || ny >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx; if (nx < 0 || nx >= w) continue;
        if (opaque[ny * w + nx]) { f = 1; break; }
      }
    }
    dil[y * w + x] = f;
  }
  const cl = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 1;
    for (let dy = -r; dy <= r && a; dy++) {
      const ny = y + dy;
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const v = (ny < 0 || ny >= h || nx < 0 || nx >= w) ? 0 : dil[ny * w + nx];
        if (!v) { a = 0; break; }
      }
    }
    cl[y * w + x] = a;
  }
  return cl;
}

async function main() {
  const isBackdrop = makeTest(mode);
  const { data, info } = await sharp(SHEET).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  const cand = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * C;
    cand[i] = isBackdrop(data[o], data[o + 1], data[o + 2]) ? 1 : 0;
  }
  const trueBg = new Uint8Array(W * H);
  const st = [];
  const seed = (i) => { if (cand[i] && !trueBg[i]) { trueBg[i] = 1; st.push(i); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (st.length) {
    const c = st.pop(), cx = c % W, cy = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (cand[n] && !trueBg[n]) { trueBg[n] = 1; st.push(n); }
    }
  }

  // components of non-background
  const labels = new Int32Array(W * H).fill(-1);
  const comps = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const idx = y * W + x;
    if (trueBg[idx] === 1 || labels[idx] !== -1) continue;
    let minX = x, maxX = x, minY = y, maxY = y, area = 0;
    labels[idx] = comps.length;
    const s2 = [idx];
    while (s2.length) {
      const cur = s2.pop(), cx = cur % W, cy = (cur / W) | 0;
      area++;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (trueBg[n] === 0 && labels[n] === -1) { labels[n] = comps.length; s2.push(n); }
      }
    }
    comps.push({ minX, minY, maxX, maxY, area });
  }
  const filtered = comps.filter((c) => (c.maxY - c.minY + 1) >= 120 && (c.maxX - c.minX + 1) >= 30 && c.area > 800);
  console.log(`mode=${mode} core=${TOL_CORE} wide=${TOL_WIDE} cast=${CAST}`);
  console.log(`  raw components=${comps.length}  filtered=${filtered.length} (slicer requires exactly 31)`);
  if (filtered.length !== 31) { console.log('  -> would FAIL the slicer assertion'); return; }

  filtered.sort((a, b) => {
    const ra = Math.floor(a.minY / 150), rb = Math.floor(b.minY / 150);
    return ra !== rb ? ra - rb : a.minX - b.minX;
  });
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < filtered.length; i++) {
    const c = filtered[i];
    const cw = c.maxX - c.minX + 1, ch = c.maxY - c.minY + 1;
    const crop = Buffer.alloc(cw * ch * 4);
    const opaque = new Uint8Array(cw * ch);
    for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
      const sx = c.minX + xx, sy = c.minY + yy;
      const so = (sy * W + sx) * C, dO = (yy * cw + xx) * 4;
      crop[dO] = data[so]; crop[dO + 1] = data[so + 1]; crop[dO + 2] = data[so + 2];
      opaque[yy * cw + xx] = trueBg[sy * W + sx] === 1 ? 0 : 1;
    }
    const closed = closeAlpha(opaque, cw, ch, 2);
    for (let p = 0; p < cw * ch; p++) crop[p * 4 + 3] = closed[p] ? 255 : 0;
    const scale = Math.min(CANVAS / cw, CANVAS / ch, 1);
    const outW = Math.max(1, Math.round(cw * scale)), outH = Math.max(1, Math.round(ch * scale));
    const rz = await sharp(crop, { raw: { width: cw, height: ch, channels: 4 } })
      .resize(outW, outH, { kernel: 'nearest', fit: 'fill' }).raw().toBuffer();
    await sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: rz, raw: { width: outW, height: outH, channels: 4 }, left: Math.round((CANVAS - outW) / 2), top: CANVAS - outH }])
      .png().toFile(path.join(outDir, `${NAMES[i]}.png`));
  }
  console.log(`  wrote 31 frames to ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
