'use strict';
// Repair transparent holes trapped inside the character art.
//
// THE BUG
// Raj's black hair showed white specks at runtime. They are holes in the
// sprite's alpha: on a transparent always-on-top window the desktop shows
// straight through them.
//
// THE CAUSE
// slice-sheet.js already closes holes in the alpha mask (closeAlpha, radius 2)
// and then downscales the crop ~3x with `kernel: 'nearest'`. Nearest-neighbour
// resampling of a binary mask *re-creates* holes after the closing has run —
// the fine background slivers between hair spikes survive as isolated
// transparent pixels in the downscaled frame. The author's defense runs one
// step too early to catch them. See the note in slice-sheet.js.
//
// WHAT COUNTS AS A HOLE
// Only *enclosed* transparent regions: those unreachable from the image border
// by a 4-connected flood fill. A gap you can trace back to the outside is real
// background. This is what protects the legitimate see-through space in the
// art — the triangle under Raj's raised arm in stretch_03, the gap between his
// legs mid-stride — all of which open to the border and are never touched.
//
// Enclosed alone is not sufficient, though, because the dog's art has genuine
// enclosed negative space: when a paw lands it closes off the wedge between
// the legs, giving 15-82px pockets that must stay transparent. Raj, Hanu, Bud
// and Pip have no intentional interior holes (verified by rendering every
// enclosed region over a magenta backdrop and inspecting it), so their sheets
// are repaired in full while the dog is capped. That difference is a fact
// about the art, not something derivable from geometry, hence the explicit
// per-sheet table below rather than one clever heuristic.
//
// HOW HOLES ARE FILLED
// Colour is propagated inward from the rim, one ring per pass, each pixel
// taking the most common opaque colour among its eight neighbours. Not a
// single flat colour for the whole region: the larger holes straddle hair and
// skin, and one flat colour would stamp a skin-toned blob into the hair.
// Most-common rather than average for the same reason averaging is wrong here
// — blending black hair with skin yields a grey that is nowhere in the
// palette.
//
// This repairs the committed frames in place. Re-slicing instead would
// re-derive every bounding box and rewrite the manifest, which is a much
// larger change for the same result.
//
// Usage:
//   node tools/fix-alpha-speckles.js [--dry] [--max-area=N] [dir ...]
//
//   --dry         report what would change, write nothing
//   --max-area=N  override the per-sheet cap for every directory
//   dir ...       directories to process (default: all five character sheets)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Largest enclosed region to treat as damage, per sheet. Infinity = this sheet
// has no intentional interior holes, so repair every one.
const MAX_AREA_BY_SHEET = {
  pal: Infinity,
  hanu: Infinity,
  boy: Infinity,
  girl: Infinity,
  // Keeps the leg gaps (15px and up); still clears the 1-8px cracks.
  dog: 8,
};
const DEFAULT_MAX_AREA = 8;
const DEFAULT_DIRS = Object.keys(MAX_AREA_BY_SHEET).map((d) => path.join('assets', d));

// Below this, a pixel is transparent enough to read as a hole.
const ALPHA_CUTOFF = 16;

// Transparent pixels reachable from the border, 4-connected. 4- rather than
// 8-connected on purpose: a single diagonal pinhole should not qualify an
// entire pocket as "outside". That leak is precisely why slice-sheet.js's own
// 8-connected background fill lets these holes through.
function borderReachable(alpha, W, H) {
  const seen = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    const i = y * W + x;
    if (!seen[i] && alpha[i] < ALPHA_CUTOFF) { seen[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  return seen;
}

// Connected groups of enclosed transparent pixels, as arrays of flat indices.
function enclosedRegions(alpha, W, H) {
  const outside = borderReachable(alpha, W, H);
  const claimed = new Uint8Array(W * H);
  const regions = [];
  for (let start = 0; start < W * H; start++) {
    if (alpha[start] >= ALPHA_CUTOFF || outside[start] || claimed[start]) continue;
    const region = [];
    const stack = [start];
    claimed[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      region.push(i);
      const x = i % W, y = (i / W) | 0;
      const neighbours = [];
      if (x > 0) neighbours.push(i - 1);
      if (x < W - 1) neighbours.push(i + 1);
      if (y > 0) neighbours.push(i - W);
      if (y < H - 1) neighbours.push(i + W);
      for (const n of neighbours) {
        if (alpha[n] < ALPHA_CUTOFF && !outside[n] && !claimed[n]) { claimed[n] = 1; stack.push(n); }
      }
    }
    regions.push(region);
  }
  return regions;
}

// Grow opaque colour into the holes, one ring per pass, until none are left.
// Each pass reads the state at its start so the result does not depend on
// scan order.
function inpaint(buf, holes, W, H) {
  const todo = new Uint8Array(W * H);
  for (const i of holes) todo[i] = 1;
  let remaining = holes.length;

  while (remaining > 0) {
    const snapshot = Buffer.from(buf);
    const writes = [];
    for (const i of holes) {
      if (!todo[i]) continue;
      const x = i % W, y = (i / W) | 0;
      const freq = new Map();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const o = (ny * W + nx) * 4;
          if (snapshot[o + 3] < ALPHA_CUTOFF) continue;
          const key = (snapshot[o] << 16) | (snapshot[o + 1] << 8) | snapshot[o + 2];
          freq.set(key, (freq.get(key) || 0) + 1);
        }
      }
      if (!freq.size) continue; // no opaque rim yet; a later pass will reach it
      let best = 0, bestCount = -1;
      for (const [key, count] of freq) if (count > bestCount) { bestCount = count; best = key; }
      writes.push([i, best]);
    }
    // A region with no opaque rim at all can never be filled; bail rather than
    // spin. Cannot happen for enclosed regions, but do not trust that blindly.
    if (!writes.length) break;
    for (const [i, key] of writes) {
      const o = i * 4;
      buf[o] = (key >> 16) & 255;
      buf[o + 1] = (key >> 8) & 255;
      buf[o + 2] = key & 255;
      buf[o + 3] = 255;
      todo[i] = 0;
      remaining--;
    }
  }
  return holes.length - remaining;
}

async function repairFile(file, maxArea, dry) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const buf = Buffer.from(data);
  const alpha = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) alpha[i] = buf[i * 4 + 3];

  const holes = [];
  let kept = 0, keptPx = 0;
  for (const region of enclosedRegions(alpha, W, H)) {
    if (region.length > maxArea) { kept++; keptPx += region.length; continue; }
    holes.push(...region);
  }

  let filled = 0;
  if (holes.length) {
    filled = inpaint(buf, holes, W, H);
    if (filled && !dry) {
      await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(file);
    }
  }
  return { filled, kept, keptPx };
}

function sheetCap(dir, override) {
  if (override !== null) return override;
  const cap = MAX_AREA_BY_SHEET[path.basename(dir)];
  return cap === undefined ? DEFAULT_MAX_AREA : cap;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const maxArg = args.find((a) => a.startsWith('--max-area='));
  const override = maxArg ? Number(maxArg.split('=')[1]) : null;
  const dirs = args.filter((a) => !a.startsWith('--'));
  const targets = dirs.length ? dirs : DEFAULT_DIRS;

  if (dry) console.log('dry run - nothing will be written\n');
  let gFilled = 0, gFiles = 0, gKept = 0, gKeptPx = 0;
  for (const dir of targets) {
    if (!fs.existsSync(dir)) { console.error(`skip (missing): ${dir}`); continue; }
    const cap = sheetCap(dir, override);
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
    let filled = 0, changed = 0, kept = 0, keptPx = 0;
    for (const f of files) {
      const r = await repairFile(path.join(dir, f), cap, dry);
      if (r.filled) { changed++; filled += r.filled; }
      kept += r.kept; keptPx += r.keptPx;
    }
    gFilled += filled; gFiles += changed; gKept += kept; gKeptPx += keptPx;
    console.log(
      `${dir.padEnd(13)} cap=${String(cap === Infinity ? 'all' : cap).padStart(3)}` +
      `  frames=${String(files.length).padStart(3)}` +
      `  repaired=${String(changed).padStart(3)}` +
      `  pxFilled=${String(filled).padStart(4)}` +
      `  kept=${kept} region(s)/${keptPx}px`
    );
  }
  console.log(
    `\n${dry ? 'would repair' : 'repaired'} ${gFilled}px across ${gFiles} frame(s); ` +
    `left ${gKept} intentional region(s) totalling ${gKeptPx}px transparent`
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
