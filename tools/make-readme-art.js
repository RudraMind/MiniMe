'use strict';
// Generates the images used by README.md from the real game assets, so the
// README can never drift from what the app actually looks like.
//
// Needs the optional art deps plus a GIF encoder:
//   npm install sharp
//   npm install --no-save gifenc
//
// Output: docs/img/*.png and docs/img/*.gif
const fs = require('fs');
const path = require('path');

let sharp, gifenc;
try {
  sharp = require('sharp');
  gifenc = require('gifenc');
} catch {
  console.error('Needs sharp and gifenc:');
  console.error('  npm install sharp');
  console.error('  npm install --no-save gifenc');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const PAL = path.join(ROOT, 'assets', 'pal');
const HOUSE = path.join(ROOT, 'assets', 'house');
const OUT = path.join(ROOT, 'docs', 'img');

// Matches the palette used by the app's own UI.
const INK = '#0f1620';
const INK2 = '#17222e';
const CREAM = '#f4f1ea';
const GOLD = '#f4d47a';

const SWATCHES = {
  red: '#c23b3b', blue: '#3b62c2', yellow: '#d1b23a',
  black: '#26262b', green: '#3f9153', orange: '#d1793a',
};

// --- shared helpers --------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

// Same garment recolour the app does at runtime (renderer/recolor.js).
async function recolored(frame, shirtHex, pantHex) {
  const { data, info } = await sharp(path.join(PAL, frame + '.png'))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const out = Buffer.from(data);
  let minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  const split = minY + (maxY - minY) * 0.58;
  const shirt = shirtHex && rgbToHsl(...hexToRgb(shirtHex));
  const pant = pantHex && rgbToHsl(...hexToRgb(pantHex));
  for (let y = minY; y <= maxY; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (out[i + 3] < 200) continue;
      const r = out[i], g = out[i + 1], b = out[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn > 14) continue;
      const lum = (r + g + b) / 3;
      if (lum < 25 || lum > 215) continue;
      const target = y <= split ? shirt : pant;
      if (!target) continue;
      const [nr, ng, nb] = hslToRgb(target[0], target[1], (mx + mn) / 2 / 255);
      out[i] = nr; out[i + 1] = ng; out[i + 2] = nb;
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

const upscale = (buf, factor) =>
  sharp(buf).metadata().then((m) =>
    sharp(buf).resize(m.width * factor, m.height * factor, { kernel: 'nearest' }).png().toBuffer());

function svgText(text, opts = {}) {
  const { size = 20, weight = 700, fill = CREAM, anchor = 'start', family = 'Segoe UI, Arial, sans-serif', letter = 0 } = opts;
  const w = Math.ceil(text.length * size * 0.75) + 40;
  const h = Math.ceil(size * 1.7);
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
       <text x="${anchor === 'middle' ? w / 2 : 4}" y="${size * 1.15}" fill="${fill}"
             font-family="${family}" font-size="${size}" font-weight="${weight}"
             letter-spacing="${letter}" text-anchor="${anchor}">${text}</text>
     </svg>`
  );
}

const panel = (w, h, fill = INK) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{
      input: Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${w}" height="${h}" rx="18" fill="${fill}"/></svg>`),
      top: 0, left: 0,
    }]).png().toBuffer();

// --- 1. hero banner --------------------------------------------------------

async function hero() {
  const W = 1200, H = 420;
  const bg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#121b26"/><stop offset="55%" stop-color="#17222e"/>
        <stop offset="100%" stop-color="#20303f"/>
      </linearGradient>
      <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0d1420" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0b1119" stop-opacity="0.85"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect y="${H - 150}" width="${W}" height="150" fill="url(#floor)"/>
    <g fill="${GOLD}" opacity="0.16">
      <circle cx="120" cy="70" r="2"/><circle cx="300" cy="40" r="1.6"/><circle cx="520" cy="86" r="1.6"/>
      <circle cx="900" cy="54" r="2"/><circle cx="1080" cy="96" r="1.6"/><circle cx="700" cy="30" r="1.6"/>
    </g>
  </svg>`);

  // Characters share one baseline along the bottom; the text block sits above
  // them so nothing overlaps.
  const BASE = H - 36;
  const houseImg = await upscale(await sharp(path.join(HOUSE, 'house_closed.png')).png().toBuffer(), 2);
  const walker = await upscale(await sharp(path.join(PAL, 'walk_03.png')).png().toBuffer(), 2);
  const sitter = await upscale(await sharp(path.join(PAL, 'sit_01.png')).png().toBuffer(), 2);
  const waver = await upscale(await sharp(path.join(PAL, 'wave_02.png')).png().toBuffer(), 2);

  return sharp(bg).composite([
    { input: houseImg, left: 920, top: BASE - 240 },
    { input: walker, left: 130, top: BASE - 144 },
    { input: sitter, left: 400, top: BASE - 144 },
    { input: waver, left: 660, top: BASE - 144 },
    { input: svgText('MiniMe', { size: 72, letter: -2 }), left: 112, top: 48 },
    { input: svgText('a tiny coworker who lives on your desktop', { size: 24, weight: 500, fill: '#a9b8c9' }), left: 118, top: 142 },
    { input: svgText('works beside you  ·  reminds you to move  ·  keeps you company', { size: 15, weight: 500, fill: GOLD }), left: 118, top: 184 },
  ]).png().toFile(path.join(OUT, 'hero.png'));
}

// --- 2. animated walk cycle -----------------------------------------------

async function walkGif() {
  const { GIFEncoder, quantize, applyPalette } = gifenc;
  const SCALE = 4, FRAME_W = 72 * SCALE, FRAME_H = 72 * SCALE;
  const PAD = 24;
  const W = FRAME_W + PAD * 2, H = FRAME_H + PAD;
  const names = ['walk_01', 'walk_02', 'walk_03', 'walk_04', 'walk_05'];

  const enc = GIFEncoder();
  for (const n of names) {
    const sprite = await sharp(path.join(PAL, n + '.png'))
      .resize(FRAME_W, FRAME_H, { kernel: 'nearest' }).png().toBuffer();
    const frame = await sharp({
      create: { width: W, height: H, channels: 4, background: { r: 23, g: 34, b: 46, alpha: 255 } },
    }).composite([{ input: sprite, left: PAD, top: 0 }]).raw().toBuffer();

    const rgba = new Uint8ClampedArray(frame);
    const palette = quantize(rgba, 64);
    const index = applyPalette(rgba, palette);
    enc.writeFrame(index, W, H, { palette, delay: 110 });
  }
  enc.finish();
  fs.writeFileSync(path.join(OUT, 'walk.gif'), Buffer.from(enc.bytes()));
}

// --- 3. pose showcase ------------------------------------------------------

async function poses() {
  const items = [
    ['stand_01', 'idle'], ['walk_03', 'walk'], ['sit_01', 'work'], ['stretch_02', 'stretch'],
    ['drink_02', 'water'], ['wave_02', 'wave'], ['dance_02', 'dance'], ['phone_01', 'phone'],
    ['crossed_01', 'focused'], ['thumbsup_01', 'nice'],
  ];
  const CELL = 148, COLS = 5, ROWS = 2, GAP = 10;
  const W = COLS * CELL + GAP * (COLS + 1), H = ROWS * (CELL + 26) + GAP * (ROWS + 1);
  const layers = [];
  for (let i = 0; i < items.length; i++) {
    const [frame, label] = items[i];
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = GAP + col * (CELL + GAP), y = GAP + row * (CELL + 26 + GAP);
    layers.push({ input: await panel(CELL, CELL, INK2), left: x, top: y });
    const sprite = await sharp(path.join(PAL, frame + '.png'))
      .resize(128, 128, { kernel: 'nearest' }).png().toBuffer();
    layers.push({ input: sprite, left: x + 10, top: y + 10 });
    layers.push({ input: svgText(label, { size: 15, weight: 600, fill: '#9fb0c2', anchor: 'middle' }), left: x, top: y + CELL + 2 });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 15, g: 22, b: 32, alpha: 255 } } })
    .composite(layers).png().toFile(path.join(OUT, 'poses.png'));
}

// --- 4. outfit colours -----------------------------------------------------

async function outfits() {
  const combos = [
    [null, null, 'original'],
    [SWATCHES.red, SWATCHES.black, 'red'],
    [SWATCHES.blue, SWATCHES.black, 'blue'],
    [SWATCHES.green, SWATCHES.yellow, 'green'],
    [SWATCHES.orange, SWATCHES.blue, 'orange'],
    [SWATCHES.yellow, SWATCHES.blue, 'yellow'],
  ];
  const CELL = 130, GAP = 10;
  const W = combos.length * CELL + GAP * (combos.length + 1), H = CELL + 26 + GAP * 2;
  const layers = [];
  for (let i = 0; i < combos.length; i++) {
    const [shirt, pant, label] = combos[i];
    const x = GAP + i * (CELL + GAP), y = GAP;
    layers.push({ input: await panel(CELL, CELL, INK2), left: x, top: y });
    const buf = shirt ? await recolored('stand_01', shirt, pant)
      : await sharp(path.join(PAL, 'stand_01.png')).png().toBuffer();
    layers.push({ input: await sharp(buf).resize(112, 112, { kernel: 'nearest' }).png().toBuffer(), left: x + 9, top: y + 9 });
    layers.push({ input: svgText(label, { size: 14, weight: 600, fill: '#9fb0c2', anchor: 'middle' }), left: x, top: y + CELL + 2 });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 15, g: 22, b: 32, alpha: 255 } } })
    .composite(layers).png().toFile(path.join(OUT, 'outfits.png'));
}

// --- 5. house states -------------------------------------------------------

async function houseStates() {
  const items = [['house_closed', 'home'], ['house_open', 'door open'], ['house_night', 'asleep']];
  const CELL = 180, GAP = 12;
  const W = items.length * CELL + GAP * (items.length + 1), H = CELL + 28 + GAP * 2;
  const layers = [];
  for (let i = 0; i < items.length; i++) {
    const [name, label] = items[i];
    const x = GAP + i * (CELL + GAP), y = GAP;
    layers.push({ input: await panel(CELL, CELL, INK2), left: x, top: y });
    const img = await sharp(path.join(HOUSE, name + '.png')).resize(156, 156, { kernel: 'nearest' }).png().toBuffer();
    layers.push({ input: img, left: x + 12, top: y + 12 });
    layers.push({ input: svgText(label, { size: 15, weight: 600, fill: '#9fb0c2', anchor: 'middle' }), left: x, top: y + CELL + 3 });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 15, g: 22, b: 32, alpha: 255 } } })
    .composite(layers).png().toFile(path.join(OUT, 'house.png'));
}

// --- 6. focus session strip ------------------------------------------------

async function focusStrip() {
  const steps = [
    ['walk_02', '1 · start a session', 'they walk over'],
    ['sit_01', '2 · they work too', 'reminders paused'],
    ['stretch_02', '3 · break together', 'stand up, stretch'],
  ];
  const CELL_W = 300, CELL_H = 210, GAP = 12;
  const W = steps.length * CELL_W + GAP * (steps.length + 1), H = CELL_H + GAP * 2;
  const layers = [];
  for (let i = 0; i < steps.length; i++) {
    const [frame, title, sub] = steps[i];
    const x = GAP + i * (CELL_W + GAP), y = GAP;
    layers.push({ input: await panel(CELL_W, CELL_H, INK2), left: x, top: y });
    const sprite = await sharp(path.join(PAL, frame + '.png')).resize(120, 120, { kernel: 'nearest' }).png().toBuffer();
    layers.push({ input: sprite, left: x + (CELL_W - 120) / 2, top: y + 16 });
    layers.push({ input: svgText(title, { size: 17, weight: 700, fill: CREAM, anchor: 'middle' }), left: x, top: y + 146 });
    layers.push({ input: svgText(sub, { size: 14, weight: 500, fill: '#8fa1b4', anchor: 'middle' }), left: x, top: y + 172 });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 15, g: 22, b: 32, alpha: 255 } } })
    .composite(layers).png().toFile(path.join(OUT, 'focus.png'));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await hero();          console.log('  hero.png');
  await walkGif();       console.log('  walk.gif');
  await poses();         console.log('  poses.png');
  await outfits();       console.log('  outfits.png');
  await houseStates();   console.log('  house.png');
  await focusStrip();    console.log('  focus.png');
  console.log('README art written to docs/img/');
}

main().catch((e) => { console.error(e); process.exit(1); });
