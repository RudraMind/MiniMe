'use strict';
// Slices a white-background character sheet into assets/<key>/.
//
//   node tools/slice-character.js hanu
//   node tools/slice-character.js            (all of them)
//
// Three things this handles that a naive crop does not:
//   1. The backdrop is WHITE, so the tolerances from slice-sheet.js (dark navy)
//      do not transfer.
//   2. Figures have drop shadows and dust puffs. Those are removed: pixels are
//      masked by connected-component LABEL rather than bounding box, then a
//      ground pass clears the bright, colourless stuff along the bottom.
//   3. Frame counts are asserted, and the size gap between the smallest kept
//      figure and the largest rejected blob is checked, so a mis-detection
//      fails loudly instead of silently shipping a shadow as a pose.
const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('This script needs "sharp", which is an optional dependency.');
  console.error('Install it with:  npm install sharp');
  console.error('You only need it to re-cut art — the sliced frames ship in the repo.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const CANVAS = 72; // must match PAL_W/PAL_H in main.js and renderer/chotu.js

// Backdrop + shadow removal, in ONE outline-aware flood from the border.
//
// Measured on these sheets: the true backdrop sits within ~10 of pure white,
// then the histogram falls off a cliff. A looser tolerance leaks through the
// anti-aliased edge of the artwork's dark linework and eats near-white art —
// the boy's white cap panel, his socks, even the whites of his eyes.
//
// The fill is therefore allowed to pass through backdrop-white pixels AND
// through shadow-like pixels (bright but colourless), but is BLOCKED by dark
// pixels. Every shape in this art style is outlined, so enclosed white areas
// are unreachable and survive, while the drop shadow and dust puffs — which sit
// in open space with no outline around them — are cleared.
const TOL = 10;
const DARK_MAX_BRI = 110;   // at or below this a pixel is linework: blocks the fill
const GROUND_MIN_BRI = 120; // shadows/dust are brighter than linework
const GROUND_MAX_SAT = 60;  // ...and far less colourful than skin or clothing
const GROUND_BAND = 0.3;    // shadow removal is confined to the bottom of the frame
// Detached fragments smaller than this fraction of the main shape are dust.
const SPECK_FRACTION = 0.02;
// The smallest kept figure must be at least this many times bigger than the
// largest thing we rejected, otherwise detection is ambiguous and we stop.
const MIN_SIZE_GAP = 2.5;

const SHEETS = {
  hanu: {
    sheet: 'hanusheet.png',
    rows: 3,
    names: [
      'hanu_walk_01', 'hanu_walk_02', 'hanu_jump_01',
      'hanu_sleep_01', 'hanu_drink_01', 'hanu_run_01',
      'hanu_run_02', 'hanu_sit_01', 'hanu_wave_01',
    ],
  },
  boy: {
    sheet: 'boysheet.png',
    rows: 3,
    // The run poses are drawn facing right while every walk pose faces left.
    // Mirror them so the whole character has ONE native facing; the renderer
    // then flips the sprite purely from travel direction.
    flip: ['boy_run_01', 'boy_run_02'],
    names: [
      'boy_walk_01', 'boy_walk_02', 'boy_jump_01', 'boy_bed_01',
      'boy_drink_01', 'boy_run_01', 'boy_run_02', 'boy_sit_01',
      'boy_wave_01', 'boy_stretch_01', 'boy_walk_03', 'boy_sleep_01',
    ],
  },
  girl: {
    sheet: 'girlsheet.png',
    rows: 3,
    flip: ['girl_run_01', 'girl_run_02'],
    names: [
      'girl_walk_01', 'girl_walk_02', 'girl_jump_01', 'girl_bed_01',
      'girl_drink_01', 'girl_run_01', 'girl_run_02', 'girl_sit_01',
      'girl_wave_01', 'girl_stretch_01', 'girl_walk_03', 'girl_sleep_01',
    ],
  },
  dog: {
    sheet: 'dogsheet.png',
    rows: 3,
    names: [
      'dog_run_01', 'dog_run_02', 'dog_wave_01', 'dog_sleep_01',
      'dog_drink_01', 'dog_walk_01', 'dog_run_03', 'dog_sit_01',
      'dog_wave_02', 'dog_sit_02', 'dog_walk_02', 'dog_lie_01',
    ],
  },
};

const whiteDist = (r, g, b) => Math.abs(r - 255) + Math.abs(g - 255) + Math.abs(b - 255);

function computeDarkMask(data, width, height, channels) {
  const dark = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    if ((data[o] + data[o + 1] + data[o + 2]) / 3 <= DARK_MAX_BRI) dark[i] = 1;
  }
  return dark;
}


// Backdrop only: pixels within TOL of pure white, reachable from the border.
// Deliberately strict — the character's own near-white art (a white cap panel,
// socks, the whites of eyes) is the SAME colour as the backdrop, so the only
// thing separating them is the artwork's outline. Any looser and the fill
// squeezes through the anti-aliased edge of that outline and hollows the art.
function backgroundMask(data, width, height, channels) {
  const isBg = (i) => {
    const o = i * channels;
    return whiteDist(data[o], data[o + 1], data[o + 2]) <= TOL;
  };
  const bg = new Uint8Array(width * height);
  const stack = [];
  const seed = (i) => { if (isBg(i) && !bg[i]) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
  while (stack.length) {
    const cur = stack.pop();
    const cx = cur % width, cy = (cur / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (isBg(n) && !bg[n]) { bg[n] = 1; stack.push(n); }
      }
    }
  }
  return bg;
}

// Label every connected non-background region, so each figure can be masked by
// its own component rather than by bounding box (a box would pull in a
// neighbouring figure's shadow).
function labelComponents(bg, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  const comps = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (bg[i] || labels[i] !== -1) continue;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0;
      const id = comps.length;
      labels[i] = id;
      const stack = [i];
      while (stack.length) {
        const cur = stack.pop();
        const cx = cur % width, cy = (cur / width) | 0;
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
            const n = ny * width + nx;
            if (!bg[n] && labels[n] === -1) { labels[n] = id; stack.push(n); }
          }
        }
      }
      comps.push({ id, minX, minY, maxX, maxY, area });
    }
  }
  return { labels, comps };
}

// The drop shadow survives the fill above (it is nowhere near white), so clear
// it here, from INSIDE the figure.
//
// The discriminator is geometric, not colour-based: a drop shadow lies BELOW
// all of the artwork's linework in its column, whereas the fill of a paw, a
// sock or a shoe always sits above that shape's own bottom outline. Colour
// cannot separate them — a cream paw and a grey shadow occupy the same
// brightness and saturation range, which is what previously erased the dog's
// front paws and left only their dark outlines behind.
function stripGround(rgba, opaque, dark, w, h) {
  // Lowest linework pixel per column; -1 where a column has none (dust puffs
  // floating beside the figure, which should go).
  const lowestDark = new Int32Array(w).fill(-1);
  for (let x = 0; x < w; x++) {
    for (let y = h - 1; y >= 0; y--) {
      if (dark[y * w + x]) { lowestDark[x] = y; break; }
    }
  }

  const bandTop = Math.floor(h * (1 - GROUND_BAND));
  const isGround = (idx) => {
    if (!opaque[idx]) return false;
    const x = idx % w, y = (idx / w) | 0;
    if (y < bandTop) return false;
    if (y <= lowestDark[x]) return false; // still inside the artwork
    const o = idx * 4;
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    const bri = (r + g + b) / 3;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    return bri >= GROUND_MIN_BRI && sat <= GROUND_MAX_SAT;
  };

  for (let i = 0; i < w * h; i++) {
    if (isGround(i)) opaque[i] = 0;
  }
}

function dropSpecks(opaque, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const sizes = [];
  for (let i = 0; i < w * h; i++) {
    if (!opaque[i] || labels[i] !== -1) continue;
    const id = sizes.length;
    let area = 0;
    labels[i] = id;
    const stack = [i];
    while (stack.length) {
      const cur = stack.pop();
      area++;
      const cx = cur % w, cy = (cur / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (opaque[n] && labels[n] === -1) { labels[n] = id; stack.push(n); }
        }
      }
    }
    sizes.push(area);
  }
  if (!sizes.length) return;
  const minKeep = Math.max(...sizes) * SPECK_FRACTION;
  for (let i = 0; i < w * h; i++) {
    if (opaque[i] && sizes[labels[i]] < minKeep) opaque[i] = 0;
  }
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

async function sliceOne(key, spec) {
  const sheetPath = path.join(ROOT, 'assets', 'reference', spec.sheet);
  const outDir = path.join(ROOT, 'assets', key);
  const expected = spec.names.length;

  const { data, info } = await sharp(sheetPath).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const bg = backgroundMask(data, width, height, channels);
  const darkMask = computeDarkMask(data, width, height, channels);
  const { labels, comps } = labelComponents(bg, width, height);

  const bySize = [...comps].sort((a, b) => b.area - a.area);
  const figures = bySize.slice(0, expected);
  const rejected = bySize[expected];
  const smallestKept = figures[figures.length - 1];

  if (figures.length !== expected) {
    console.error(`FATAL [${key}]: only found ${figures.length} components, expected ${expected}.`);
    process.exit(1);
  }
  // Guard against a shadow sneaking in as a "figure".
  if (rejected && smallestKept.area < rejected.area * MIN_SIZE_GAP) {
    console.error(`FATAL [${key}]: figure detection is ambiguous — smallest kept ${smallestKept.area}px `
      + `vs largest rejected ${rejected.area}px (need ${MIN_SIZE_GAP}x separation). Not guessing.`);
    process.exit(1);
  }

  // Reading order: rows top to bottom, then left to right within a row.
  const band = height / spec.rows;
  figures.sort((a, b) => {
    const ra = Math.floor((a.minY + (a.maxY - a.minY) / 2) / band);
    const rb = Math.floor((b.minY + (b.maxY - b.minY) / 2) / band);
    if (ra !== rb) return ra - rb;
    return a.minX - b.minX;
  });

  fs.mkdirSync(outDir, { recursive: true });
  const manifest = [];

  for (let i = 0; i < figures.length; i++) {
    const c = figures[i];
    const name = spec.names[i];
    const cw = c.maxX - c.minX + 1;
    const ch = c.maxY - c.minY + 1;

    const rgba = Buffer.alloc(cw * ch * 4);
    const opaque = new Uint8Array(cw * ch);
    for (let yy = 0; yy < ch; yy++) {
      for (let xx = 0; xx < cw; xx++) {
        const src = (c.minY + yy) * width + (c.minX + xx);
        const sidx = src * channels;
        const didx = (yy * cw + xx) * 4;
        rgba[didx] = data[sidx];
        rgba[didx + 1] = data[sidx + 1];
        rgba[didx + 2] = data[sidx + 2];
        // Only this figure's own component — never a neighbouring shadow.
        opaque[yy * cw + xx] = labels[src] === c.id ? 1 : 0;
      }
    }

    const darkCrop = new Uint8Array(cw * ch);
    for (let yy = 0; yy < ch; yy++) {
      for (let xx = 0; xx < cw; xx++) {
        darkCrop[yy * cw + xx] = darkMask[(c.minY + yy) * width + (c.minX + xx)];
      }
    }
    stripGround(rgba, opaque, darkCrop, cw, ch);
    dropSpecks(opaque, cw, ch);
    const closed = closeAlpha(opaque, cw, ch, 2);
    for (let p = 0; p < cw * ch; p++) rgba[p * 4 + 3] = closed[p] ? 255 : 0;

    // Re-tighten: removing the shadow leaves dead space that would otherwise
    // shrink the character inside the canvas.
    let tMinX = cw, tMaxX = -1, tMinY = ch, tMaxY = -1;
    for (let yy = 0; yy < ch; yy++) {
      for (let xx = 0; xx < cw; xx++) {
        if (rgba[(yy * cw + xx) * 4 + 3] === 0) continue;
        if (xx < tMinX) tMinX = xx;
        if (xx > tMaxX) tMaxX = xx;
        if (yy < tMinY) tMinY = yy;
        if (yy > tMaxY) tMaxY = yy;
      }
    }
    if (tMaxX < 0) {
      console.error(`FATAL [${key}]: ${name} came out empty after ground removal.`);
      process.exit(1);
    }
    const tw = tMaxX - tMinX + 1;
    const th = tMaxY - tMinY + 1;
    const tight = Buffer.alloc(tw * th * 4);
    for (let yy = 0; yy < th; yy++) {
      for (let xx = 0; xx < tw; xx++) {
        const s = ((tMinY + yy) * cw + (tMinX + xx)) * 4;
        const d = (yy * tw + xx) * 4;
        tight[d] = rgba[s]; tight[d + 1] = rgba[s + 1];
        tight[d + 2] = rgba[s + 2]; tight[d + 3] = rgba[s + 3];
      }
    }

    const scale = Math.min(CANVAS / tw, CANVAS / th, 1);
    const outW = Math.max(1, Math.round(tw * scale));
    const outH = Math.max(1, Math.round(th * scale));
    // NOTE: .flop() after .composite() on a created canvas is silently ignored
    // by sharp, so the mirror has to happen here, on the image itself.
    let resizePipe = sharp(tight, { raw: { width: tw, height: th, channels: 4 } })
      .resize(outW, outH, { kernel: 'nearest', fit: 'fill' });
    if (spec.flip && spec.flip.includes(name)) resizePipe = resizePipe.flop();
    const resized = await resizePipe.raw().toBuffer();

    const composed = sharp({
      create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{
        input: resized,
        raw: { width: outW, height: outH, channels: 4 },
        left: Math.round((CANVAS - outW) / 2),
        top: CANVAS - outH, // bottom-aligned so the pose doesn't bob
      }]);
    await composed.png().toFile(path.join(outDir, `${name}.png`));

    manifest.push({ index: i, name, sourceBBox: { x: c.minX, y: c.minY, width: cw, height: ch }, area: c.area });
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[${key}] ${figures.length} frames -> assets/${key}/  `
    + `(smallest kept ${smallestKept.area}px, largest rejected ${rejected ? rejected.area : 0}px)`);
}

async function main() {
  const only = process.argv[2];
  const keys = only ? [only] : Object.keys(SHEETS);
  for (const key of keys) {
    if (!SHEETS[key]) {
      console.error(`Unknown character "${key}". Known: ${Object.keys(SHEETS).join(', ')}`);
      process.exit(1);
    }
    await sliceOne(key, SHEETS[key]);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
