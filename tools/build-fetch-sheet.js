'use strict';
// Assembles assets/reference/dogfetchsheet.png, the sheet tools/slice-character.js
// cuts the dog's fetch poses from.
//
//   node tools/build-fetch-sheet.js
//
// WHY A BUILD STEP RATHER THAN A HAND-EDITED IMAGE
// The generated source (assets/reference/dogfetchsource.png) contains eight poses,
// only some of which are usable, and two of the four poses fetch needs have to have a
// bone composited into them. Doing that here rather than in an image editor means the
// offsets are recorded, reviewable and reproducible, and the sheet can be rebuilt if
// the source is ever regenerated.
//
// WHAT IT PRODUCES
// Four poses on a flat white sheet, laid out 2x2 with wide gutters:
//
//   dog_carry_01   trotting right, already carrying the bone in the source art
//   dog_carry_02   trotting right, bone composited into the open mouth
//   dog_pickup_01  head down at a bone on the ground (this pose faces LEFT)
//   dog_hold_01    sitting square to the viewer with the bone in its mouth
//
// The bone prop itself is lifted out of the source too, as its own connected shape, so
// the prop on the floor and the bone in the mouth are the same drawing.
//
// WHY THE BONE IS BISCUIT BROWN
// Measured: the old cream bone composited onto the dog's muzzle lands 114 pixels
// exactly where intended and is invisible, because the dog is cream as well. Contrast
// had to come from the art.
const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('This tool needs "sharp", which is an optional dependency.');
  console.error('Install it with:  npm install sharp');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'reference', 'dogfetchsource.png');
const OUT_SHEET = path.join(ROOT, 'assets', 'reference', 'dogfetchsheet.png');
const OUT_BONE = path.join(ROOT, 'assets', 'props', 'bone.png');

// Backdrop tolerance, matching slice-character.js.
const TOL = 12;

// Figure bounding boxes, found by connected-component analysis of the source.
const SRC = {
  carryBone: { left: 61, top: 72, width: 371, height: 331 },   // trots right, has a bone
  trot:      { left: 913, top: 471, width: 340, height: 345 }, // trots right, empty mouth
  noseDown:  { left: 1359, top: 516, width: 364, height: 308 },// head on the ground, faces left
  sitBone:   { left: 516, top: 469, width: 294, height: 343 }, // sits facing viewer, has a bone
};
// A point inside the bone that was drawn flying beside one of the poses. Seeded rather
// than cropped so the three small motion-arc marks beside it are not picked up.
const BONE_SEED = { x: 1700, y: 55 };

// Bone placements, read off a 50px ruler drawn over each figure and then confirmed by
// subtraction: each blend changes only the prop's own footprint.
const PLACE = {
  trot: { x: 245, y: 130 },      // across the open mouth, over the tongue
  noseDown: { x: 37, y: 248 },   // on the ground at the muzzle, sitting on the ground line
};

// Sheet layout. Cells are far larger than any figure so the soft shadows in the source
// cannot bridge two poses into one connected component, which would break the slicer's
// frame count.
// On-screen size of the bone prop, in sprite pixels. The dog renders 72px tall, and the
// old prop was 20px of drawn bone, so this keeps it in that range.
const PROP_W = 22;

const COLS = 2;
const CELL_W = 640;
const CELL_H = 420;

function isWhite(d, i) {
  return (255 - Math.min(d[i], d[i + 1], d[i + 2])) <= TOL;
}

async function rawOf(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: Buffer.from(data), w: info.width, h: info.height };
}

// One connected non-white shape, on a transparent canvas, trimmed to itself.
function shapeAt(src, seed) {
  const { data, w, h } = src;
  const start = seed.y * w + seed.x;
  if (isWhite(data, start * 4)) throw new Error('bone seed landed on the backdrop');
  const seen = new Uint8Array(w * h);
  const stack = [start];
  seen[start] = 1;
  const px = [];
  let minX = w, maxX = -1, minY = h, maxY = -1;
  while (stack.length) {
    const p = stack.pop();
    px.push(p);
    const x = p % w, y = (p - x) / w;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const np = ny * w + nx;
      if (!seen[np] && !isWhite(data, np * 4)) { seen[np] = 1; stack.push(np); }
    }
  }
  const sw = maxX - minX + 1, sh = maxY - minY + 1;
  const out = Buffer.alloc(sw * sh * 4, 0);
  for (const p of px) {
    const x = p % w, y = (p - x) / w;
    const d = ((y - minY) * sw + (x - minX)) * 4;
    const s = p * 4;
    out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = 255;
  }
  return { data: out, w: sw, h: sh, count: px.length };
}

// Alpha-blend by hand. sharp's composite() was disturbing roughly 14,000 pixels for a
// 63x59 prop and reporting a bounding box covering most of the figure, which made it
// impossible to verify placement. This changes exactly the prop's footprint.
function blend(base, over, ox, oy) {
  const out = Buffer.from(base.data);
  let changed = 0;
  for (let y = 0; y < over.h; y++) {
    const by = oy + y;
    if (by < 0 || by >= base.h) continue;
    for (let x = 0; x < over.w; x++) {
      const bx = ox + x;
      if (bx < 0 || bx >= base.w) continue;
      const s = (y * over.w + x) * 4;
      const a = over.data[s + 3] / 255;
      if (a === 0) continue;
      const d = (by * base.w + bx) * 4;
      for (let k = 0; k < 3; k++) out[d + k] = Math.round(over.data[s + k] * a + out[d + k] * (1 - a));
      out[d + 3] = Math.max(out[d + 3], over.data[s + 3]);
      changed++;
    }
  }
  return { data: out, w: base.w, h: base.h, changed };
}

async function cropRaw(box) {
  const { data, info } = await sharp(SOURCE).extract(box).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  return { data: Buffer.from(data), w: info.width, h: info.height };
}

async function main() {
  const src = await rawOf(SOURCE);
  const bone = shapeAt(src, BONE_SEED);
  console.log(`bone lifted from the source: ${bone.w}x${bone.h}, ${bone.count} px`);

  // Two sizes, and they are not interchangeable.
  //
  // For compositing INTO the sheet the bone must be at sheet scale, because the slicer
  // downscales each whole figure to a 72px canvas afterwards and the bone has to shrink
  // with it. Drawn slightly smaller than it appears flying through the air, which is
  // exaggerated for the throw.
  const sheetBonePng = await sharp(bone.data, { raw: { width: bone.w, height: bone.h, channels: 4 } })
    .resize(Math.round(bone.w * 0.72)).png().toBuffer();
  fs.writeFileSync(path.join(ROOT, 'assets', 'props', '.bone-sheetscale.png'), sheetBonePng);
  const boneSheetScale = await rawOf(path.join(ROOT, 'assets', 'props', '.bone-sheetscale.png'));

  // For the PROP the renderer draws on screen, the bone must already be at sprite
  // scale. The figures on the sheet are ~345px tall and end up 72px, so anything left at
  // sheet scale would render about five times too large — a bone nearly as big as the dog.
  const bonePng = await sharp(bone.data, { raw: { width: bone.w, height: bone.h, channels: 4 } })
    .resize(PROP_W).png().toBuffer();
  fs.writeFileSync(OUT_BONE, bonePng);
  const propMeta = await sharp(OUT_BONE).metadata();
  fs.unlinkSync(path.join(ROOT, 'assets', 'props', '.bone-sheetscale.png'));
  console.log(`wrote ${path.relative(ROOT, OUT_BONE)} at ${propMeta.width}x${propMeta.height} `
    + `(sprite scale) from a ${boneSheetScale.w}x${boneSheetScale.h} sheet-scale copy`);
  const boneSmall = boneSheetScale;

  const frames = [];
  frames.push({ name: 'dog_carry_01', img: await cropRaw(SRC.carryBone) });

  const trot = blend(await cropRaw(SRC.trot), boneSmall, PLACE.trot.x, PLACE.trot.y);
  console.log(`dog_carry_02: bone blended at ${PLACE.trot.x},${PLACE.trot.y}, ${trot.changed} px changed`);
  frames.push({ name: 'dog_carry_02', img: trot });

  const nose = blend(await cropRaw(SRC.noseDown), boneSmall, PLACE.noseDown.x, PLACE.noseDown.y);
  console.log(`dog_pickup_01: bone blended at ${PLACE.noseDown.x},${PLACE.noseDown.y}, ${nose.changed} px changed`);
  frames.push({ name: 'dog_pickup_01', img: nose });

  frames.push({ name: 'dog_hold_01', img: await cropRaw(SRC.sitBone) });

  const rows = Math.ceil(frames.length / COLS);
  const sheetW = CELL_W * COLS;
  const sheetH = CELL_H * rows;
  const sheet = Buffer.alloc(sheetW * sheetH * 4);
  for (let p = 0; p < sheetW * sheetH; p++) {
    sheet[p * 4] = 255; sheet[p * 4 + 1] = 255; sheet[p * 4 + 2] = 255; sheet[p * 4 + 3] = 255;
  }

  frames.forEach((f, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const ox = col * CELL_W + Math.round((CELL_W - f.img.w) / 2);
    const oy = row * CELL_H + Math.round((CELL_H - f.img.h) / 2);
    for (let y = 0; y < f.img.h; y++) {
      for (let x = 0; x < f.img.w; x++) {
        const s = (y * f.img.w + x) * 4;
        const d = ((oy + y) * sheetW + (ox + x)) * 4;
        // The crops keep their white backdrop, so this is a straight copy: the sheet
        // must read as one flat white field to the slicer.
        sheet[d] = f.img.data[s]; sheet[d + 1] = f.img.data[s + 1];
        sheet[d + 2] = f.img.data[s + 2]; sheet[d + 3] = 255;
      }
    }
    console.log(`  ${f.name} placed at ${ox},${oy} (${f.img.w}x${f.img.h})`);
  });

  await sharp(sheet, { raw: { width: sheetW, height: sheetH, channels: 4 } }).png().toFile(OUT_SHEET);
  console.log(`\nwrote ${path.relative(ROOT, OUT_SHEET)} at ${sheetW}x${sheetH}, ${frames.length} poses`);
  console.log('frame order: ' + frames.map((f) => f.name).join(', '));
}

if (require.main === module) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
