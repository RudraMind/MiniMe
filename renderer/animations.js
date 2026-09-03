// Animation tables, one per character.
//
// The state machine only ever emits SEMANTIC animation names (idle, walk, run,
// stretch, drink, sit, wave, ...). Each character maps those onto whatever art
// it actually has, so a character with fewer poses still behaves correctly —
// resolveFrames() falls back to 'idle' for anything it lacks.

export const CHARACTERS = {
  raj: {
    label: 'Raj',
    defaultName: 'Chotu',
    dir: '../assets/pal/',
    // Which way the source art faces. The renderer mirrors from travel
    // direction, so getting this wrong makes the character moonwalk.
    nativeFacing: 'left',
    // Raj's art is a plain shirt + trousers, so the outfit recolour applies.
    recolorable: true,
    // Idle flourishes this character can actually perform.
    flourishes: { phone: 3, crossed: 3, splash: 2, thumbsup: 2, glasses: 2, dance: 1, jump: 1, sit: 2 },
    animations: {
      idle:     { frames: ['stand_01'], ms: 1000, loop: true },
      walk:     { frames: ['walk_01', 'walk_02', 'walk_03', 'walk_04', 'walk_05'], ms: 110, loop: true },
      // No dedicated run art — hurrying home just walks.
      run:      { frames: ['walk_01', 'walk_02', 'walk_03', 'walk_04', 'walk_05'], ms: 90, loop: true },
      wave:     { frames: ['wave_01', 'wave_02', 'wave_03', 'wave_02'], ms: 180, loop: false },
      stretch:  { frames: ['stretch_01', 'stretch_02', 'stretch_03'], ms: 700, loop: true },
      drink:    { frames: ['drink_01', 'drink_02', 'drink_03'], ms: 550, loop: true },
      splash:   { frames: ['splash_01', 'splash_02', 'splash_03'], ms: 400, loop: false },
      dance:    { frames: ['dance_01', 'dance_02', 'dance_03', 'dance_04'], ms: 160, loop: true },
      glasses:  { frames: ['glasses_01', 'glasses_02', 'glasses_03'], ms: 300, loop: false },
      thumbsup: { frames: ['thumbsup_01'], ms: 1200, loop: false },
      point:    { frames: ['point_01'], ms: 1200, loop: false },
      crossed:  { frames: ['crossed_01'], ms: 1500, loop: false },
      phone:    { frames: ['phone_01'], ms: 2000, loop: false },
      jump:     { frames: ['jump_01'], ms: 500, loop: false },
      sit:      { frames: ['sit_01'], ms: 2000, loop: false },
    },
  },

  hanu: {
    label: 'Hanu',
    defaultName: 'Hanu',
    dir: '../assets/hanu/',
    nativeFacing: 'left',
    // Hanu's outfit is saturated orange and gold; the recolour targets
    // near-neutral garment pixels and would do nothing useful here.
    recolorable: false,
    flourishes: { sit: 3, wave: 2, jump: 1 },
    animations: {
      // The only genuinely upright pose in the sheet.
      idle:     { frames: ['hanu_wave_01'], ms: 1000, loop: true },
      walk:     { frames: ['hanu_walk_01', 'hanu_walk_02'], ms: 200, loop: true },
      run:      { frames: ['hanu_run_01', 'hanu_run_02'], ms: 130, loop: true },
      wave:     { frames: ['hanu_wave_01'], ms: 900, loop: false },
      // Exercise time is a leaping mace-raise rather than a stretch.
      stretch:  { frames: ['hanu_jump_01'], ms: 700, loop: true },
      jump:     { frames: ['hanu_jump_01'], ms: 600, loop: false },
      drink:    { frames: ['hanu_drink_01'], ms: 900, loop: true },
      sit:      { frames: ['hanu_sit_01'], ms: 2000, loop: false },
      sleep:    { frames: ['hanu_sleep_01'], ms: 2000, loop: false },
    },
  },
};

// Boy and girl share an identical 12-pose sheet layout.
function kidAnimations(p) {
  return {
    // The only upright standing pose on the sheet.
    idle:    { frames: [`${p}_wave_01`], ms: 1000, loop: true },
    walk:    { frames: [`${p}_walk_01`, `${p}_walk_02`, `${p}_walk_03`], ms: 160, loop: true },
    run:     { frames: [`${p}_run_01`, `${p}_run_02`], ms: 120, loop: true },
    wave:    { frames: [`${p}_wave_01`], ms: 900, loop: false },
    stretch: { frames: [`${p}_stretch_01`], ms: 800, loop: true },
    jump:    { frames: [`${p}_jump_01`], ms: 600, loop: false },
    drink:   { frames: [`${p}_drink_01`], ms: 900, loop: true },
    sit:     { frames: [`${p}_sit_01`], ms: 2000, loop: false },
    sleep:   { frames: [`${p}_sleep_01`], ms: 2000, loop: false },
    bed:     { frames: [`${p}_bed_01`], ms: 2000, loop: false },
  };
}

CHARACTERS.boy = {
  label: 'Boy',
  defaultName: 'Bud',
  dir: '../assets/boy/',
  nativeFacing: 'left',
  // Striped shirt and denim shorts — the neutral-garment recolour would
  // misfire on them, so it's off.
  recolorable: false,
  flourishes: { sit: 3, wave: 2, jump: 2, stretch: 1 },
  animations: kidAnimations('boy'),
};

CHARACTERS.girl = {
  label: 'Girl',
  defaultName: 'Pip',
  dir: '../assets/girl/',
  nativeFacing: 'left',
  recolorable: false,
  flourishes: { sit: 3, wave: 2, jump: 2, stretch: 1 },
  animations: kidAnimations('girl'),
};

CHARACTERS.dog = {
  label: 'Dog',
  defaultName: 'Scout',
  dir: '../assets/dog/',
  nativeFacing: 'right',
  recolorable: false,
  flourishes: { sit: 2, wave: 2, lie: 2, play: 4 },
  animations: {
    // A dog at rest sits, rather than standing to attention.
    idle:    { frames: ['dog_sit_01'], ms: 1200, loop: true },
    // A trot, not a flip-book. dog_walk_01 is a three-quarter view while
    // dog_walk_02 is a side profile, so alternating those two reads as the dog
    // spinning on the spot. This cycle stays in profile and alternates
    // contact (legs down) with suspension (legs extended), which is what
    // actually reads as walking.
    walk:    { frames: ['dog_walk_02', 'dog_run_03', 'dog_walk_02', 'dog_run_02'], ms: 170, loop: true },
    run:     { frames: ['dog_run_01', 'dog_run_02', 'dog_run_03'], ms: 110, loop: true },
    // Raised paw stands in for a wave.
    wave:    { frames: ['dog_wave_01', 'dog_wave_02'], ms: 450, loop: false },
    // No stretch pose exists, so exercise time is an energetic bound.
    stretch: { frames: ['dog_run_01', 'dog_run_02'], ms: 220, loop: true },
    jump:    { frames: ['dog_run_02'], ms: 600, loop: false },
    // Bouncing around the bone — quick, and a different frame order to the
    // run cycle so play doesn't just look like running.
    play:    { frames: ['dog_run_02', 'dog_run_01', 'dog_run_03', 'dog_run_01'], ms: 130, loop: true },
    drink:   { frames: ['dog_drink_01'], ms: 900, loop: true },
    sit:     { frames: ['dog_sit_02'], ms: 2000, loop: false },
    lie:     { frames: ['dog_lie_01'], ms: 2500, loop: false },
    sleep:   { frames: ['dog_sleep_01'], ms: 2000, loop: false },
  },
};

export const DEFAULT_CHARACTER = 'raj';

export function getCharacter(key) {
  return CHARACTERS[key] || CHARACTERS[DEFAULT_CHARACTER];
}

// Resolve an animation for a character, falling back to idle when that
// character has no art for it (Hanu has no 'dance', for example).
export function resolveAnimation(characterKey, name) {
  const c = getCharacter(characterKey);
  return c.animations[name] || c.animations.idle;
}

// Every frame file a character can display, for preloading.
export function allFrames(characterKey) {
  const c = getCharacter(characterKey);
  return [...new Set(Object.values(c.animations).flatMap((a) => a.frames))];
}
