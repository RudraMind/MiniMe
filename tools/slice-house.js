'use strict';
// Slices the 3-state house sheet into assets/house/.
// Uses the same border-flood-fill + morphological-closing masking as
// slice-sheet.js: a plain per-pixel color test punches holes through dark
// interior detail (window frames, door shading) that happens to match the
// backdrop, and those holes show the desktop through the house at runtime.
const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('This script needs "sharp", which is an optional dependency.');
  console.error('Install it with:  npm install sharp');
  console.error('You only need it to re-cut art — assets/house/ ships generated.');
  process.exit(1);
}

const SHEET = path.join(__dirname, '..', 'assets', 'reference', 'housesheet.png');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'house');
const BG = [12, 19, 30];
// Measured: true backdrop pixels sit within ~20 of BG, while the roof's dark
// mortar lines sit at 30-40. A tolerance of 40 let the flood fill seep through
// the jagged shingle gaps and hollow out the roof, so keep it below that band.
const TOL = 25;
// Left-to-right in the sheet.
const NAMES = ['house_closed', 'house_open', 'house_night'];
// Rendered house size. Resampled once from the ~471px source rather than
// downscaling an already-sliced 160px PNG, which would soften the pixel art.
// Must match HOUSE_W/HOUSE_H in main.js and renderer/chotu.js.
const OUT_W = 120;

function bgDiff(r, g, b) {
  return Math.abs(r - BG[0]) + Math.abs(g - BG[1]) + Math.abs(b - BG[2]);
}

function trueBackgroundMask(data, width, height, channels) {
  const candidate = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    candidate[i] = bgDiff(data[o], data[o + 1], data[o + 2]) <= TOL ? 1 : 0;
  }
  const trueBg = new Uint8Array(width * height);
  const stack = [];
  const seed = (idx) => {
    if (candidate[idx] && !trueBg[idx]) {
      trueBg[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (stack.length) {
    const cur = stack.pop();
    const cx = cur % width;
    const cy = (cur / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nidx = ny * width + nx;
        if (candidate[nidx] && !trueBg[nidx]) {
          trueBg[nidx] = 1;
          stack.push(nidx);
        }
      }
    }
  }
  return trueBg;
}

function components(trueBg, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  const out = [];
  const stack = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (trueBg[idx] === 1 || labels[idx] !== -1) continue;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0;
      labels[idx] = out.length;
      stack.length = 0;
      stack.push(idx);
      while (stack.length) {
        const cur = stack.pop();
        const cx = cur % width;
        const cy = (cur / width) | 0;
        area++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nidx = ny * width + nx;
            if (trueBg[nidx] === 0 && labels[nidx] === -1) {
              labels[nidx] = out.length;
              stack.push(nidx);
            }
          }
        }
      }
      out.push({ minX, minY, maxX, maxY, area });
    }
  }
  return out;
}

function closeAlpha(opaque, w, h, r) {
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -r; dy <= r && !hit; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (opaque[ny * w + nx]) { hit = 1; break; }
        }
      }
      dil[y * w + x] = hit;
    }
  }
  const closed = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let all = 1;
      for (let dy = -r; dy <= r && all; dy++) {
        const ny = y + dy;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const v = (ny < 0 || ny >= h || nx < 0 || nx >= w) ? 0 : dil[ny * w + nx];
          if (!v) { all = 0; break; }
        }
      }
      closed[y * w + x] = all;
    }
  }
  return closed;
}

async function main() {
  const { data, info } = await sharp(SHEET).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const trueBg = trueBackgroundMask(data, width, height, channels);
  const all = components(trueBg, width, height);
  const houses = all.filter((c) => (c.maxX - c.minX) > 80 && (c.maxY - c.minY) > 80 && c.area > 5000);
  console.log(`components: ${all.length} raw, ${houses.length} house-sized`);

  if (houses.length !== 3) {
    console.error(`FATAL: expected exactly 3 houses, got ${houses.length}. Not guessing.`);
    process.exit(1);
  }
  houses.sort((a, b) => a.minX - b.minX);

  // One shared canvas size keeps the three states pixel-aligned, so swapping
  // between them can't make the house jump.
  const maxW = Math.max(...houses.map((c) => c.maxX - c.minX + 1));
  const maxH = Math.max(...houses.map((c) => c.maxY - c.minY + 1));
  const scale = OUT_W / maxW;
  const outW = OUT_W;
  const outH = Math.round(maxH * scale);
  console.log(`source ${maxW}x${maxH} -> output ${outW}x${outH}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];

  for (let i = 0; i < houses.length; i++) {
    const c = houses[i];
    const cw = c.maxX - c.minX + 1;
    const ch = c.maxY - c.minY + 1;
    const rgba = Buffer.alloc(maxW * maxH * 4);
    const opaque = new Uint8Array(maxW * maxH);
    // Bottom-center each state inside the shared canvas.
    const offX = Math.round((maxW - cw) / 2);
    const offY = maxH - ch;

    for (let yy = 0; yy < ch; yy++) {
      for (let xx = 0; xx < cw; xx++) {
        const sx = c.minX + xx, sy = c.minY + yy;
        const sidx = (sy * width + sx) * channels;
        const dx = offX + xx, dy = offY + yy;
        const didx = (dy * maxW + dx) * 4;
        rgba[didx] = data[sidx];
        rgba[didx + 1] = data[sidx + 1];
        rgba[didx + 2] = data[sidx + 2];
        opaque[dy * maxW + dx] = trueBg[sy * width + sx] === 1 ? 0 : 1;
      }
    }

    const closed = closeAlpha(opaque, maxW, maxH, 2);
    for (let p = 0; p < maxW * maxH; p++) rgba[p * 4 + 3] = closed[p] ? 255 : 0;

    const outPath = path.join(OUT_DIR, `${NAMES[i]}.png`);
    await sharp(rgba, { raw: { width: maxW, height: maxH, channels: 4 } })
      .resize(outW, outH, { kernel: 'nearest', fit: 'fill' })
      .png()
      .toFile(outPath);

    manifest.push({ name: NAMES[i], sourceBBox: { x: c.minX, y: c.minY, width: cw, height: ch } });
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ width: outW, height: outH, states: manifest }, null, 2),
    'utf8'
  );
  console.log(`Wrote ${houses.length} house states + manifest.json to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
