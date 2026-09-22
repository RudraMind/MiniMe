'use strict';
// Checks that every frame shipped in assets/ faces the way the slicers would cut
// it today. Run with `npm run verify:facing`.
//
// WHY A SEPARATE CHECK
// test/facing-sim.js asserts that the tables agree with each other — that
// nativeFacing matches the recorded facing, that every frame has an entry, and
// that no animation mixes facings. It cannot look at a pixel, so it cannot catch
// art that was mirrored by hand, mirrored twice, or never re-cut after the
// facing table changed. That is exactly how the original bug survived: the flip
// list was edited, the art was not, and the commit still read as a fix.
//
// HOW IT COMPARES
// Not byte for byte. The shipped character frames carry a hole-repair pass that
// slice-character.js does not run (tools/fix-alpha-speckles.js is separate), and
// frames mirrored in place were re-centred on the canvas. So this measures
// ORIENTATION: for each frame it takes the alpha silhouette, and scores the
// shipped frame against the fresh slice and against the mirror of the fresh
// slice. Whichever is closer says which way round the shipped frame is. A frame
// that scores closer to the mirror is reported as wrong.
//
// COST
// It re-cuts every sheet into a temporary directory, so it needs sharp and takes
// a few seconds. That is why it is not part of `npm test`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('This check needs "sharp", which is an optional dependency.');
  console.error('Install it with:  npm install sharp');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const DIRS = ['pal', 'hanu', 'boy', 'girl', 'dog'];

// Silhouette of a frame: 1 where the sprite is opaque, 0 where the desktop shows
// through. Colour is ignored on purpose — the repair pass and the PNG re-encode
// both nudge colour, while a mirror is a wholesale change of shape.
async function silhouette(file, flop) {
  let img = sharp(file);
  if (flop) img = img.flop();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(info.width * info.height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] > 127 ? 1 : 0;
  return out;
}

function distance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'minime-facing-'));
  try {
    // The slicers resolve their paths from their own location, so give them a
    // throwaway tree with only the source sheets in it. assets/ is never touched.
    fs.mkdirSync(path.join(work, 'assets', 'reference'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'tools'), path.join(work, 'tools'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'assets', 'reference'), path.join(work, 'assets', 'reference'), { recursive: true });

    const env = { ...process.env, NODE_PATH: path.join(ROOT, 'node_modules') };
    for (const slicer of ['slice-character.js', 'slice-sheet.js']) {
      execFileSync(process.execPath, [path.join(work, 'tools', slicer)], { cwd: work, env, stdio: 'ignore' });
    }

    let checked = 0;
    const wrong = [];
    for (const dir of DIRS) {
      const freshDir = path.join(work, 'assets', dir);
      if (!fs.existsSync(freshDir)) {
        wrong.push(`${dir}/: the slicer produced nothing`);
        continue;
      }
      for (const file of fs.readdirSync(freshDir).filter((f) => f.endsWith('.png'))) {
        const shipped = path.join(ROOT, 'assets', dir, file);
        if (!fs.existsSync(shipped)) {
          wrong.push(`${dir}/${file}: cut from the sheet but not shipped`);
          continue;
        }
        const fresh = path.join(freshDir, file);
        const a = await silhouette(shipped, false);
        const same = await silhouette(fresh, false);
        const mirrored = await silhouette(fresh, true);
        if (a.length !== same.length) {
          wrong.push(`${dir}/${file}: canvas size differs from the slicer's`);
          continue;
        }
        checked++;
        const dSame = distance(a, same);
        const dMirror = distance(a, mirrored);
        if (dSame >= dMirror) {
          wrong.push(`${dir}/${file}: shipped art is mirrored relative to the slicer (same=${dSame} mirrored=${dMirror})`);
        }
      }
    }

    for (const line of wrong) console.log(`FAIL  ${line}`);
    console.log(`\n${checked} frames compared, ${wrong.length} wrong.`);
    process.exit(wrong.length === 0 ? 0 : 1);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
