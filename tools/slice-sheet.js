'use strict';
const fs = require('fs');
const path = require('path');
// Raj's walk poses all face left, but two of his flourishes (pointing, sitting)
// are drawn in right-facing profile. The renderer can only mirror from travel
// direction, so those two are mirrored here instead.
const { flipSet } = require('./frame-facing.js');

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
// Loose distance to the backdrop colour. Needed to catch the antialiased rim
// where the flat backdrop blends into the art; without it adjacent sprites stay
// connected through leftover backdrop and findComponents() merges them (a plain
// TOL of 8 yields 26 components instead of 31). See BG_CAST below for the other
// half of the test.
const TOL = 40;
// Anything this close to the backdrop is backdrop, cast test or not.
const TOL_CORE = 10;
// The backdrop is a blue-dominant navy: b - r = +15. Raj's hair is near-black
// but *neutral*, b - r = 0..3, and several of its tones land within TOL of the
// backdrop. Distance alone therefore cannot tell them apart, and because the
// hair is the outermost part of the silhouette the border flood fill walked
// straight into it and hollowed it out — roughly a third of the hair mass was
// being keyed away as background, leaving the transparent specks that showed
// the desktop through his hair at runtime. Requiring the backdrop's blue cast
// for anything outside TOL_CORE keeps neutral dark art opaque while still
// clearing the rim, which does carry the cast because it is part backdrop.
const BG_CAST = 6;
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

// Could this pixel be backdrop? Two-part test, see TOL_CORE / BG_CAST above.
function isBgColor(r, g, b) {
  const d = bgDiff(r, g, b);
  if (d <= TOL_CORE) return true;
  return d <= TOL && (b - r) >= BG_CAST;
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
    bgCandidate[i] = isBgColor(data[o], data[o + 1], data[o + 2]) ? 1 : 0;
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

// Fill transparent pixels that are trapped inside the art, i.e. unreachable
// from the edge of the frame. Runs on the *downscaled* frame: closeAlpha above
// operates at source resolution, and the ~3x nearest-neighbour resize that
// follows it can reopen sub-pixel gaps that closing had already sealed. Colour
// is grown inward from the rim one ring at a time, each pixel taking the most
// common opaque colour among its eight neighbours — a single flat fill would
// stamp one tone across a hole that straddles hair and skin, and averaging
// would invent a grey that is nowhere in the palette.
//
// Safe to apply unconditionally here because Raj's sheet has no intentional
// see-through space inside the silhouette; the genuine gaps (under a raised
// arm, between his legs mid-stride) all open to the frame edge and so are
// never reached. tools/fix-alpha-speckles.js does the same for the other
// sheets, where the dog's leg gaps do need an area cap.
function fillEnclosedHoles(rgba, w, h) {
  const CUT = 16;
  const isClear = (i) => rgba[i * 4 + 3] < CUT;

  // Transparent pixels reachable from the border, 4-connected. 4- and not
  // 8-connected so a lone diagonal pinhole cannot mark a whole pocket
  // "outside" — that leak is why the 8-connected fill above misses these.
  const outside = new Uint8Array(w * h);
  const stack = [];
  const seed = (x, y) => {
    const i = y * w + x;
    if (!outside[i] && isClear(i)) { outside[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }

  const todo = [];
  for (let i = 0; i < w * h; i++) if (isClear(i) && !outside[i]) todo.push(i);
  if (!todo.length) return 0;

  const pending = new Uint8Array(w * h);
  for (const i of todo) pending[i] = 1;
  let left = todo.length;
  while (left > 0) {
    // Snapshot so a pass does not depend on scan order.
    const snap = Buffer.from(rgba);
    const writes = [];
    for (const i of todo) {
      if (!pending[i]) continue;
      const x = i % w, y = (i / w) | 0;
      const freq = new Map();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const o = (ny * w + nx) * 4;
          if (snap[o + 3] < CUT) continue;
          const key = (snap[o] << 16) | (snap[o + 1] << 8) | snap[o + 2];
          freq.set(key, (freq.get(key) || 0) + 1);
        }
      }
      if (!freq.size) continue; // no opaque rim yet; a later ring reaches it
      let best = 0, bestN = -1;
      for (const [k, n] of freq) if (n > bestN) { bestN = n; best = k; }
      writes.push([i, best]);
    }
    if (!writes.length) break; // cannot happen for enclosed pixels; don't spin
    for (const [i, key] of writes) {
      const o = i * 4;
      rgba[o] = (key >> 16) & 255;
      rgba[o + 1] = (key >> 8) & 255;
      rgba[o + 2] = key & 255;
      rgba[o + 3] = 255;
      pending[i] = 0;
      left--;
    }
  }
  return todo.length - left;
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
  // assets/pal/ is Raj, whose key in the facing table is 'raj'.
  const flips = flipSet('raj');
  const manifest = [];
  let patched = 0;

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

    patched += fillEnclosedHoles(resizedRaw, outW, outH);

    // Mirror the against-the-grain poses here, on the frame itself. It has to
    // happen before the composite below: sharp silently ignores .flop() applied
    // after .composite() onto a created canvas, which makes a mirror that looks
    // like it worked and does nothing. Running after fillEnclosedHoles is safe —
    // mirroring moves alpha, it does not open new holes.
    let frameRaw = resizedRaw;
    if (flips.has(name)) {
      frameRaw = await sharp(resizedRaw, { raw: { width: outW, height: outH, channels: 4 } })
        .flop()
        .raw()
        .toBuffer();
    }

    const left = Math.round((CANVAS - outW) / 2);
    const top = CANVAS - outH; // bottom-aligned

    const outPath = path.join(OUT_DIR, `${name}.png`);
    await sharp({
      create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: frameRaw, raw: { width: outW, height: outH, channels: 4 }, left, top }])
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
  console.log(`Patched ${patched} enclosed transparent pixel(s) after downscaling.`);
}

// Only re-cut art when run as a command — see the same guard in
// slice-character.js. A bare require() of this file used to rewrite assets/pal/.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { NAMES };
