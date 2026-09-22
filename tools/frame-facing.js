'use strict';
// Which way every pose in the SOURCE sheets faces, and which way each character
// should face once sliced.
//
// WHY THIS FILE EXISTS
// The renderer mirrors the whole sprite from travel direction and reads ONE
// `nativeFacing` per character (renderer/chotu.js). That is only correct if
// every frame of a character faces the same way. The source sheets do not:
// within a single walk cycle the artist drew some poses facing left and some
// facing right. Any cycle that mixes both makes the character snap around on
// every step.
//
// The slicers used to carry a hand-written `flip: [...]` list instead. That list
// was wrong in both directions at once — it flipped boy_run_01 and girl_run_01,
// which already faced the right way, and it missed walk_03, sit_01 and
// stretch_01, which did not. Recording the facing of each source pose and
// DERIVING the flip set removes the chance to get that list half right.
//
// HOW THE VALUES WERE ESTABLISHED
// By reading each sheet in assets/reference/ directly, frame by frame, in the
// same order as the slicer's `names` list. The reliable cues are the ones that
// sit at the back of the figure: Hanu's tail, the boy's and girl's hair (bun,
// bow, cap brim), the dog's tail, and the dust puffs, which always trail the
// run. Raj wears sunglasses, so his nose is the cue.
//
// 'front' means the pose has no meaningful horizontal direction — it faces the
// viewer (waving, dancing, jumping, standing) or it is lying down. Mirroring
// such a pose reads the same either way, so it is deliberately left alone
// rather than forced into the character's facing. Only a clear profile or
// three-quarter pose with an unmistakable forward direction is labelled
// 'left' or 'right'.

// `target` is the facing every sliced frame of that character must end up in.
// It MUST agree with `nativeFacing` in renderer/animations.js; test/facing-sim.js
// asserts that, because the two drifting apart is what made Raj moonwalk.
const FACING = {
  raj: {
    target: 'left',
    frames: {
      // The five walk poses are the only frames that carry travel, and the
      // artist drew all five facing left.
      walk_01: 'left', walk_02: 'left', walk_03: 'left', walk_04: 'left', walk_05: 'left',
      wave_01: 'front', wave_02: 'front', wave_03: 'front',
      glasses_01: 'front', glasses_02: 'front', glasses_03: 'front',
      stand_01: 'front',
      dance_01: 'front', dance_02: 'front', dance_03: 'front', dance_04: 'front',
      // Head tipped back with the bottle: the torso still squares to the
      // viewer, so these read the same mirrored.
      drink_01: 'front', drink_02: 'front', drink_03: 'front',
      splash_01: 'front', splash_02: 'front', splash_03: 'front',
      stretch_01: 'front', stretch_02: 'front', stretch_03: 'front',
      thumbsup_01: 'front',
      // Arm extended along the line of sight — unmistakably a profile.
      point_01: 'right',
      crossed_01: 'front',
      phone_01: 'front',
      jump_01: 'front',
      // Sitting across the chair, in profile.
      sit_01: 'right',
    },
  },

  hanu: {
    target: 'left',
    frames: {
      hanu_walk_01: 'left',
      hanu_walk_02: 'right',
      hanu_jump_01: 'right',
      // Asleep in bed: no facing.
      hanu_sleep_01: 'front',
      hanu_drink_01: 'right',
      hanu_run_01: 'left',
      hanu_run_02: 'right',
      hanu_sit_01: 'right',
      hanu_wave_01: 'front',
    },
  },

  // The boy's and girl's sheets share a layout, and they share these facings.
  boy: {
    target: 'left',
    frames: {
      boy_walk_01: 'left',
      boy_walk_02: 'left',
      // The odd one out of the three-frame walk: drawn facing the other way.
      boy_walk_03: 'right',
      boy_run_01: 'left',
      boy_run_02: 'right',
      boy_drink_01: 'left',
      boy_sit_01: 'right',
      boy_stretch_01: 'right',
      boy_jump_01: 'front',
      boy_wave_01: 'front',
      boy_bed_01: 'front',
      boy_sleep_01: 'front',
    },
  },

  girl: {
    target: 'left',
    frames: {
      girl_walk_01: 'left',
      girl_walk_02: 'left',
      girl_walk_03: 'right',
      girl_run_01: 'left',
      girl_run_02: 'right',
      girl_drink_01: 'left',
      girl_sit_01: 'right',
      girl_stretch_01: 'right',
      girl_jump_01: 'front',
      girl_wave_01: 'front',
      girl_bed_01: 'front',
      girl_sleep_01: 'front',
    },
  },

  dog: {
    // The dog's sheet is mostly drawn facing right, so right is cheaper to
    // reach than left.
    target: 'right',
    frames: {
      dog_run_01: 'right',
      dog_run_02: 'right',
      dog_run_03: 'right',
      // Drawn facing the other way to the rest of the sheet. This is why the
      // walk cycle in renderer/animations.js had to avoid it by hand.
      dog_walk_01: 'left',
      dog_walk_02: 'right',
      dog_drink_01: 'left',
      dog_wave_01: 'right',
      // Sitting or lying square to the viewer, tail to one side: no facing.
      dog_wave_02: 'front',
      dog_sit_01: 'front',
      dog_sit_02: 'front',
      dog_sleep_01: 'front',
      dog_lie_01: 'front',
    },
  },
};

// The frames a slicer must mirror for this character: every pose that has a
// facing and is drawn the wrong way round. 'front' poses are never mirrored.
function flipSet(key) {
  const spec = FACING[key];
  if (!spec) throw new Error(`No facing recorded for character "${key}"`);
  const out = new Set();
  for (const [frame, facing] of Object.entries(spec.frames)) {
    if (facing !== 'front' && facing !== spec.target) out.add(frame);
  }
  return out;
}

// What a frame faces once the slicer has done its mirroring — the facing the
// app actually renders. Either the character's target, or 'front'.
function resolvedFacing(key, frame) {
  const spec = FACING[key];
  const facing = spec && spec.frames[frame];
  if (!facing) return null;
  if (facing === 'front') return 'front';
  return spec.target;
}

module.exports = { FACING, flipSet, resolvedFacing };
