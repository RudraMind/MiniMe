'use strict';
// Checks, from pixels, that no animation plays two frames facing opposite ways.
// Run with `npm run verify:facing`, or against another tree with
// `node tools/verify-facing.js --assets /path/to/assets`.
//
// WHY THIS IS NOT test/facing-sim.js
// That harness compares the tables to each other. It cannot see art: every
// assertion in it is derived from tools/frame-facing.js, so a facing recorded
// backwards there is invisible to it AND to any check built on it. That is not a
// hypothetical — the first two attempts at fixing the snap both passed a full
// green suite while the app still snapped, because the table itself was wrong.
//
// SO THIS CHECK NEVER READS THE TABLE
// It takes the animation frame lists from renderer/animations.js, which is what
// the renderer actually plays, and compares the frames of each animation against
// each other in pixels. If frame B matches frame A better mirrored than as-is,
// the two are drawn facing opposite ways, and the sprite will snap round
// mid-cycle no matter what any table says.
//
// THE COMPARISON
// The head band, in colour. Facing lives in the head: hair mass and ear on the
// trailing side, face and nose on the leading side. Legs and arms differ wildly
// between poses in the same cycle, which is noise for this question, so the lower
// two thirds of the frame is left out.
//
// THE THRESHOLD
// Measured on this art. With the nine known-bad pairs present, every one scored
// mirror/same <= 0.69; with them fixed, the most mirror-like remaining pair (two
// of Raj's frontal stretch poses) scores 0.79. 0.75 sits in that gap. Front-facing
// poses land near or above 1.0 and are not at risk of being flagged.
const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('This check needs "sharp", which is an optional dependency.');
  console.error('Install it with:  npm install sharp');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const BAND_H = 34;          // head band, of a 72px frame
const MIRROR_RATIO = 0.75;  // below this, the pair is a mirror of each other

function assetsRoot() {
  const i = process.argv.indexOf('--assets');
  return i === -1 ? path.join(ROOT, 'assets') : path.resolve(process.argv[i + 1]);
}

// renderer/animations.js is an ES module and package.json has no "type": "module",
// so require() would throw on `export`. It imports nothing itself, so handing the
// source to Node as a data URL runs it with real module semantics — no build step,
// and no second copy of the animation tables to drift.
async function loadAnimations() {
  const src = fs.readFileSync(path.join(ROOT, 'renderer', 'animations.js'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
}

async function headBand(file, flop) {
  let img = sharp(file).extract({ left: 0, top: 0, width: 72, height: BAND_H });
  if (flop) img = img.flop();
  const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}

// Mean absolute RGB difference, with a transparent-vs-opaque mismatch counted as
// a full miss so silhouette still contributes. Scaled down to keep it readable.
function difference(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aOpaque = a[i + 3] > 127;
    const bOpaque = b[i + 3] > 127;
    if (!aOpaque && !bOpaque) continue;
    if (aOpaque !== bOpaque) { total += 255 * 3; continue; }
    total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  return Math.round(total / 1000);
}

async function main() {
  const assets = assetsRoot();
  const { CHARACTERS } = await loadAnimations();
  const failures = [];
  let pairs = 0;

  for (const [key, character] of Object.entries(CHARACTERS)) {
    const dir = character.dir.replace(/^\.\.\/assets\//, '').replace(/\/$/, '');
    for (const [animName, anim] of Object.entries(character.animations)) {
      if (!anim.frames || anim.frames.length === 0) {
        failures.push(`${key}.${animName}: animation has no frames`);
        continue;
      }
      const frames = [...new Set(anim.frames)];
      const missing = frames.filter((f) => !fs.existsSync(path.join(assets, dir, `${f}.png`)));
      if (missing.length) {
        failures.push(`${key}.${animName}: missing art for ${missing.join(', ')}`);
        continue;
      }
      for (let i = 0; i < frames.length; i++) {
        for (let j = i + 1; j < frames.length; j++) {
          const a = await headBand(path.join(assets, dir, `${frames[i]}.png`), false);
          const same = difference(a, await headBand(path.join(assets, dir, `${frames[j]}.png`), false));
          const mirrored = difference(a, await headBand(path.join(assets, dir, `${frames[j]}.png`), true));
          pairs++;
          const ratio = mirrored / (same || 1);
          if (ratio < MIRROR_RATIO) {
            failures.push(`${key}.${animName}: ${frames[i]} and ${frames[j]} face opposite ways `
              + `(mirrored match ${mirrored} beats as-is ${same}, ratio ${ratio.toFixed(2)})`);
          }
        }
      }
    }
  }

  for (const line of failures) console.log(`FAIL  ${line}`);
  console.log(`\n${pairs} frame pairs compared in ${assets}, ${failures.length} facing the wrong way.`);
  process.exit(failures.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
