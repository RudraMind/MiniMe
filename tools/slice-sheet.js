'use strict';
const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('This script needs "sharp", which is an optional dependency.');
  console.error('Install it with:  npm install sharp');
  console.error('You only need it to re-cut sprites — the app ships with assets/pal/ already generated.');
  process.exit(1);
}

const SHEET_PATH = path.join(__dirname, '..', 'assets', 'reference', 'spritesheet.png');
const OUT_DIR = path.join(__dirname, '..', 'assets', 'pal');
const BG = [23, 29, 38];
const TOL = 40;
// Rendered sprite size. Must match PAL_W/PAL_H in main.js and renderer/chotu.js
// and the #pal size in renderer/chotu.css.
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
  'thumbsup_01',
  'point_01',
  'crossed_01',
  'phone_01',
  'jump_01',
  'sit_01',
];

function bgDiff(r, g, b) {
  return Math.abs(r - BG[0]) + Math.abs(g - BG[1]) + Math.abs(b - BG[2]);
}

// A pixel is only "true background" if it's reachable from the sheet's outer
// border through other background-colored pixels. This keeps dark interior
// shading (cap creases, collar shadow) opaque even when its color happens to
// be close to the flat backdrop — a raw per-pixel color-distance test would
// otherwise punch transparent holes clean through the character.
function computeTrueBackgroundMask(data, width, height, channels) {
  const bgCandidate = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    bgCandidate[i] = bgDiff(data[o], data[o + 1], data[o + 2]) <= TOL ? 1 : 0;
  }

  const trueBg = new Uint8Array(width * height);
  const stack = [];

  const seed = (idx) => {
    if (bgCandidate[idx] && !trueBg[idx]) {
      trueBg[idx] = 1;
      stack.push(idx);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x); // top row
    seed((height - 1) * width + x); // bottom row
  }
  for (let y = 0; y < height; y++) {
    seed(y * width); // left column
    seed(y * width + (width - 1)); // right column
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
        if (bgCandidate[nidx] && !trueBg[nidx]) {
          trueBg[nidx] = 1;
          stack.push(nidx);
        }
      }
    }
  }

  return trueBg;
}

// Morphological closing (dilate then erode) on a binary opaque mask. Patches
// thin 1-2px notches/seams in the source art (e.g. a cap-brim seam that's
// genuinely connected to the sheet background) that would otherwise remain
// transparent and let the desktop show through the character at runtime.
function closeAlpha(opaque, w, h, r) {
  const dilated = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let found = 0;
      for (let dy = -r; dy <= r && !found; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (opaque[ny * w + nx]) { found = 1; break; }
        }
      }
      dilated[y * w + x] = found;
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
          const v = (ny < 0 || ny >= h || nx < 0 || nx >= w) ? 0 : dilated[ny * w + nx];
          if (!v) { all = 0; break; }
        }
      }
      closed[y * w + x] = all;
    }
  }
  return closed;
}

function findComponents(trueBg, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  const components = [];
  const stack = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (trueBg[idx] === 1 || labels[idx] !== -1) continue;

      let minX = x, maxX = x, minY = y, maxY = y, area = 0;
      labels[idx] = components.length;
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
              labels[nidx] = components.length;
              stack.push(nidx);
            }
          }
        }
      }

      components.push({ minX, minY, maxX, maxY, area });
    }
  }

  return components;
}

async function main() {
  const raw = await sharp(SHEET_PATH).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  const { width, height, channels } = info;

  const trueBg = computeTrueBackgroundMask(data, width, height, channels);
  const components = findComponents(trueBg, width, height);
  console.log(`Raw components: ${components.length}`);

  const filtered = components.filter((c) => {
    const w = c.maxX - c.minX + 1;
    const h = c.maxY - c.minY + 1;
    return h >= 120 && w >= 30 && c.area > 800;
  });
  console.log(`Filtered components: ${filtered.length}`);

  if (filtered.length !== 31) {
    console.error(`FATAL: expected exactly 31 components after filtering, got ${filtered.length}.`);
    console.error('Stopping per spec — not guessing or loosening thresholds.');
    process.exit(1);
  }

  filtered.sort((a, b) => {
    const ra = Math.floor(a.minY / 150);
    const rb = Math.floor(b.minY / 150);
    if (ra !== rb) return ra - rb;
    return a.minX - b.minX;
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];

  for (let i = 0; i < filtered.length; i++) {
    const c = filtered[i];
    const name = NAMES[i];
    const cw = c.maxX - c.minX + 1;
    const ch = c.maxY - c.minY + 1;

    const cropRGBA = Buffer.alloc(cw * ch * 4);
    const opaque = new Uint8Array(cw * ch);
    for (let yy = 0; yy < ch; yy++) {
      for (let xx = 0; xx < cw; xx++) {
        const sx = c.minX + xx, sy = c.minY + yy;
        const sidx = (sy * width + sx) * channels;
        const didx = (yy * cw + xx) * 4;
        const r = data[sidx], g = data[sidx + 1], b = data[sidx + 2];
        cropRGBA[didx] = r;
        cropRGBA[didx + 1] = g;
        cropRGBA[didx + 2] = b;
        opaque[yy * cw + xx] = trueBg[sy * width + sx] === 1 ? 0 : 1;
      }
    }

    const closedOpaque = closeAlpha(opaque, cw, ch, 2);
    for (let p = 0; p < cw * ch; p++) {
      cropRGBA[p * 4 + 3] = closedOpaque[p] ? 255 : 0;
    }

    const scale = Math.min(CANVAS / cw, CANVAS / ch, 1);
    const outW = Math.max(1, Math.round(cw * scale));
    const outH = Math.max(1, Math.round(ch * scale));

    const resizedRaw = await sharp(cropRGBA, { raw: { width: cw, height: ch, channels: 4 } })
      .resize(outW, outH, { kernel: 'nearest', fit: 'fill' })
      .raw()
      .toBuffer();

    const left = Math.round((CANVAS - outW) / 2);
    const top = CANVAS - outH; // bottom-aligned

    const outPath = path.join(OUT_DIR, `${name}.png`);
    await sharp({
      create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: resizedRaw, raw: { width: outW, height: outH, channels: 4 }, left, top }])
      .png()
      .toFile(outPath);

    manifest.push({
      index: i,
      name,
      originalBBox: { x: c.minX, y: c.minY, width: cw, height: ch },
      area: c.area,
    });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Wrote ${filtered.length} frames + manifest.json to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
