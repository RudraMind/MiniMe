'use strict';
// Applies tools/defringe.js to the shipped frames of the characters cut from a
// white sheet.
//
//   node tools/defringe-frames.js            report only, changes nothing
//   node tools/defringe-frames.js --apply    rewrite the frames
//
// Only hanu, boy, girl and dog. Raj is cut from a dark navy sheet by
// tools/slice-sheet.js, so his fringe is dark rather than pale and a white-spill
// pass would find nothing to do — measured: 0% of his edge pixels are near-white,
// against 25-60% for the other four.
//
// Frames that have already been through the pass are skipped, not processed again.
// See the note on alreadyDefringed(): a second run would erode the sprite.
const fs = require('fs');
const path = require('path');
const { defringe, alreadyDefringed } = require('./defringe.js');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('This tool needs "sharp", which is an optional dependency.');
  console.error('Install it with:  npm install sharp');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const WHITE_SHEET_DIRS = ['hanu', 'boy', 'girl', 'dog'];

async function main() {
  const apply = process.argv.includes('--apply');
  let changedFrames = 0, skipped = 0, totalPixels = 0, totalProtected = 0;

  for (const dir of WHITE_SHEET_DIRS) {
    const abs = path.join(ROOT, 'assets', dir);
    for (const file of fs.readdirSync(abs).filter((f) => f.endsWith('.png')).sort()) {
      const full = path.join(abs, file);
      const { data, info } = await sharp(full).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const buf = Buffer.from(data);

      if (alreadyDefringed(buf)) {
        console.log(`skip     ${dir}/${file}  already softened`);
        skipped++;
        continue;
      }

      const { changed, protectedPx } = defringe(buf, info.width, info.height);
      totalPixels += changed;
      totalProtected += protectedPx;
      if (changed === 0) {
        console.log(`clean    ${dir}/${file}`);
        continue;
      }
      changedFrames++;
      console.log(`${apply ? 'defringe' : 'would do'} ${dir}/${file}  ${changed} px softened, `
        + `${protectedPx} left alone (art was white)`);

      if (apply) {
        const out = await sharp(buf, { raw: { width: info.width, height: info.height, channels: 4 } })
          .png().toBuffer();
        fs.writeFileSync(full, out);
      }
    }
  }

  console.log(`\n${changedFrames} frames ${apply ? 'rewritten' : 'would change'}, ${skipped} skipped, `
    + `${totalPixels} edge pixels softened, ${totalProtected} protected as real white art.`);
  if (!apply) console.log('Nothing was written. Re-run with --apply to commit the change to disk.');
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
