// Facing harness. Checks that the art each character animation plays can all be
// mirrored by one number.
//
// THE BUG THIS EXISTS FOR
// renderer/chotu.js mirrors the whole sprite from travel direction and reads a
// single `nativeFacing` per character. So every frame of a character has to face
// the same way. The source sheets do not: boy_walk_03, hanu_walk_02, girl_walk_03
// and others are drawn facing opposite their own walk cycle, which made the
// characters snap left-right on every step. Raj had the other half of the same
// bug — his `nativeFacing` said right while all five of his walk poses face left,
// so he moonwalked in both directions.
//
// Rule for adding cases: assert against tools/frame-facing.js, never against a
// pixel. The facings in that file were read off the source sheets by eye; this
// harness checks that the code agrees with them and that nothing has drifted.
const fs = require('fs');
const path = require('path');
const { FACING, flipSet, resolvedFacing } = require('../tools/frame-facing.js');

const ROOT = path.join(__dirname, '..');
let failures = 0;

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failures++;
}

// renderer/animations.js is an ES module and package.json has no "type": "module",
// so require() would parse it as CommonJS and throw on `export`. It imports nothing
// itself, so handing the source to Node as a data URL runs it with real module
// semantics — no build step, no temp file, and no second copy of the tables.
async function loadAnimations() {
  const src = fs.readFileSync(path.join(ROOT, 'renderer', 'animations.js'), 'utf8');
  const url = 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');
  return import(url);
}

function framesOnDisk(dir) {
  const abs = path.join(ROOT, 'assets', dir);
  return fs.readdirSync(abs)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/, ''))
    .sort();
}

async function main() {
  const { CHARACTERS } = await loadAnimations();

  for (const [key, character] of Object.entries(CHARACTERS)) {
    const spec = FACING[key];
    check(`${key}: has a recorded source facing`, !!spec);
    if (!spec) continue;

    // The defect that broke Raj: the renderer's nativeFacing and the recorded
    // art disagreed, so travel direction was mirrored against the wrong sign.
    check(`${key}: nativeFacing agrees with recorded target`,
      character.nativeFacing === spec.target,
      `renderer=${character.nativeFacing} table=${spec.target}`);

    // Art and table must describe the same set of frames, or a new pose can
    // arrive with no facing recorded and silently inherit the wrong mirror.
    const dir = character.dir.replace(/^\.\.\/assets\//, '').replace(/\/$/, '');
    const onDisk = framesOnDisk(dir);
    const recorded = Object.keys(spec.frames).sort();
    const missing = onDisk.filter((f) => !spec.frames[f]);
    const stale = recorded.filter((f) => !onDisk.includes(f));
    check(`${key}: every frame on disk has a recorded facing`, missing.length === 0, missing.join(', '));
    check(`${key}: every recorded frame exists on disk`, stale.length === 0, stale.join(', '));

    // resolveAnimation() falls back to idle for anything a character lacks, so a
    // typo in a frame name degrades quietly instead of failing. Catch it here.
    for (const [animName, anim] of Object.entries(character.animations)) {
      const absent = anim.frames.filter((f) => !onDisk.includes(f));
      check(`${key}.${animName}: every frame exists on disk`, absent.length === 0, absent.join(', '));

      // The invariant the renderer depends on: one animation, one facing.
      const facings = new Set(anim.frames.map((f) => resolvedFacing(key, f)).filter((f) => f !== 'front'));
      check(`${key}.${animName}: all frames share one facing`,
        facings.size <= 1 && !facings.has(null),
        [...facings].join('/') || 'all front');
    }
  }

  // The hand-written `flip: [...]` lists were the bug: they flipped two frames
  // that were already correct and missed four that were not. Derive, don't list.
  for (const slicer of ['slice-character.js', 'slice-sheet.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'tools', slicer), 'utf8');
    check(`${slicer}: carries no hand-written flip list`, !/^\s*flip:\s*\[/m.test(src));
    check(`${slicer}: derives its mirrors from frame-facing.js`, src.includes('flipSet('));
  }

  // Spot-check the derived sets, so a rewrite of flipSet() cannot quietly widen
  // or empty them. These are the frames drawn against their character's grain.
  const expected = {
    raj: ['point_01', 'sit_01'],
    hanu: ['hanu_drink_01', 'hanu_jump_01', 'hanu_run_02', 'hanu_sit_01', 'hanu_walk_02'],
    boy: ['boy_run_02', 'boy_sit_01', 'boy_stretch_01', 'boy_walk_03'],
    girl: ['girl_run_02', 'girl_sit_01', 'girl_stretch_01', 'girl_walk_03'],
    dog: ['dog_drink_01', 'dog_walk_01'],
  };
  for (const [key, frames] of Object.entries(expected)) {
    const got = [...flipSet(key)].sort();
    check(`${key}: derived mirror set`, got.join(',') === frames.join(','), got.join(', '));
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
