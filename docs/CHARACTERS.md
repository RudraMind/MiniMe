# Characters and art — reference

What each character is, what art it actually has, and what happens when the
behaviour code asks for a pose the art doesn't contain.

Every table here was generated from the real files, not written by hand. To
re-check any of it, see [Verifying this document](#verifying-this-document) at
the end.

Companion doc: [BEHAVIOUR.md](BEHAVIOUR.md) — states, the chair, the boredom
ladder, settings.

---

## The one rule that matters

**The state machine never names a picture.** `state.js` emits *semantic* pose
names — `walk`, `sit`, `doze`, `inspect` — and each character maps those onto
whatever art it owns. Nothing in `state.js` or `main.js` knows a filename.

```
state.js  →  "doze"  →  renderer/animations.js  →  raj: sit_01
                                                →  dog: dog_sleep_01
```

So a character with 9 frames and a character with 31 frames run the exact same
behaviour code. Adding a pose to the behaviour never requires adding art.

Where this lives: `renderer/animations.js`. Three moving parts:

| Part | Job |
|---|---|
| `CHARACTERS[key].animations` | The poses this character genuinely draws |
| `DERIVED_POSES` | For poses **nobody** draws — the substitute list, best first |
| `resolveAnimation(key, name)` | direct hit → derived list → `idle` as last resort |

---

## The five characters

| Key | Label | Default name | Art folder | Files | Poses | Art faces | Recolourable |
|---|---|---|---|---|---|---|---|
| `raj` | Raj | Chotu | `assets/pal/` | 31 | 15 | **right** | **yes** |
| `hanu` | Hanu | Hanu | `assets/hanu/` | 9 | 9 | left | no |
| `boy` | Boy | Bud | `assets/boy/` | 12 | 10 | left | no |
| `girl` | Girl | Pip | `assets/girl/` | 12 | 10 | left | no |
| `dog` | Dog | Scout | `assets/dog/` | 12 | 11 | **right** | no |

`raj` is the default (`DEFAULT_CHARACTER`). Every frame is a **72×72 PNG with
transparency**; the house is 120×120. The selected character is stored under
`character` and the display name under `palName` — switching character overwrites
`palName` with that character's default, then it stays editable in Settings.

**Two definitions, deliberately:** `main.js` has a `CHARACTERS` table too. It
carries only what the main process needs to decide *behaviour* (`flourishes`,
`moods`), because the main process must never load art. `renderer/animations.js`
carries the art. Add a character and you touch both.

---

### `raj` — "Chotu" — the default, and the only one with a full sheet

`assets/pal/` · faces right · recolourable · 31 frames, all used

```
idle stand_01                          point    point_01
walk walk_01..05        (110ms loop)   crossed  crossed_01
run  walk_01..05        (90ms loop)    phone    phone_01
wave wave_01,02,03,02   (180ms)        jump     jump_01
stretch stretch_01..03                 sit      sit_01
drink   drink_01..03                   thumbsup thumbsup_01
splash  splash_01..03                  glasses  glasses_01..03
dance   dance_01..04
```

Things that are true only of Raj:

- **His sheet faces right.** Every other human character faces left. Get
  `nativeFacing` wrong and he walks backwards — this shipped as a real bug once
  (see `MACOS-PORT.md` §2.14).
- **He is the only recolourable character**, because his outfit is a plain shirt
  and trousers. See [Outfit recolouring](#outfit-recolouring).
- **He has no run art.** `run` reuses the walk cycle at 90ms instead of 110ms.
- **He cannot lie down and cannot sleep.** No `lie`, no `sleep`, no `bed` art. He
  is the reason `DERIVED_POSES` is a table rather than one substitution: for Raj
  dozing has to be a **sit**, while every other character can actually lie down.
  This is why the doze rung also shows a `zzz` bubble — without it, dozing and
  sitting are the same picture.
- **He needs no `moods` map**, because he owns every pose the app can ask for.

### `hanu` — "Hanu"

`assets/hanu/` · faces left · not recolourable · 9 frames, all used

```
idle    hanu_wave_01     walk  hanu_walk_01,02  (200ms)
wave    hanu_wave_01     run   hanu_run_01,02   (130ms)
stretch hanu_jump_01     drink hanu_drink_01
jump    hanu_jump_01     sit   hanu_sit_01
                         sleep hanu_sleep_01
```

- **His "idle" is a wave frame** — the only genuinely upright pose on the sheet.
  The same is true of `boy` and `girl`.
- **Exercise time is a leaping mace-raise**, not a stretch: `stretch` →
  `hanu_jump_01`.
- **Not recolourable on purpose.** His outfit is saturated orange and gold; the
  recolour targets near-neutral garment pixels and would do nothing useful.
- Has `sleep` art but no `bed`.

### `boy` / `girl` — "Bud" / "Pip"

`assets/boy/`, `assets/girl/` · face left · not recolourable · 12 frames each

These two are **one sheet layout with two skins**. Both are built by the shared
`kidAnimations(prefix)` function — a change to one is automatically a change to
both, and they cannot drift apart. 10 poses: `idle` (a wave frame), `walk` (3
frames), `run`, `wave`, `stretch`, `jump`, `drink`, `sit`, `sleep`, `bed`.

Not recolourable: striped shirt and denim shorts, which the neutral-garment
recolour would misfire on.

**`bed` is dead art.** Nothing displays it — see
[Art nothing ever shows](#art-nothing-ever-shows).

### `dog` — "Scout" — the odd one out

`assets/dog/` · faces right · not recolourable · 12 files, **11 used**

```
idle  dog_sit_01                      wave    dog_wave_01,02
walk  dog_walk_02, dog_run_03,        stretch dog_run_01,02
      dog_walk_02, dog_run_02 (170ms) jump    dog_run_02
run   dog_run_01,02,03                drink   dog_drink_01
play  dog_run_02,01,03,01 (130ms)     sit     dog_sit_02
                                      lie     dog_lie_01
                                      sleep   dog_sleep_01
```

Four things are unique to the dog, and all four are deliberate:

1. **`idle` is a sit.** A dog at rest sits rather than standing to attention. So
   `dog_sit_01` is the resting pose and `dog_sit_02` is the "asked to sit" pose —
   two different files for what sounds like one thing.
2. **`dog_walk_01` is the only asset in the project that is never used.** It's a
   three-quarter view while `dog_walk_02` is a side profile, so alternating them
   read as the dog *spinning on the spot*. The walk cycle instead stays in
   profile and alternates contact (legs down, `dog_walk_02`) with suspension
   (legs extended, `dog_run_02/03`). Don't "fix" this by adding it back.
3. **He is the only character with a game.** `play` and the `PLAYING` state —
   bouncing around a bone dropped where the game started (`assets/props/bone.png`).
   Reachable only through his `flourishes` weights, so only the dog ever plays.
4. **`play` uses run frames in a different order** to the run cycle, at 130ms, so
   playing doesn't just look like running.

---

## What every character actually plays

Generated by calling `resolveAnimation()` for every pose the app can ask for.
`~` means **that character has no art for it** and this is the substitute.
`+n` means "and n more frames".

```
pose     raj             hanu            boy             girl            dog
idle     stand_01        hanu_wave_01    boy_wave_01     girl_wave_01    dog_sit_01
walk     walk_01+4       hanu_walk_01+1  boy_walk_01+2   girl_walk_01+2  dog_walk_02+3
run      walk_01+4       hanu_run_01+1   boy_run_01+1    girl_run_01+1   dog_run_01+2
wave     wave_01+3       hanu_wave_01    boy_wave_01     girl_wave_01    dog_wave_01+1
stretch  stretch_01+2    hanu_jump_01    boy_stretch_01  girl_stretch_01 dog_run_01+1
drink    drink_01+2      hanu_drink_01   boy_drink_01    girl_drink_01   dog_drink_01
sit      sit_01          hanu_sit_01     boy_sit_01      girl_sit_01     dog_sit_02
play     ~stand_01       ~hanu_wave_01   ~boy_wave_01    ~girl_wave_01   dog_run_02+3
doze     ~sit_01         ~hanu_sleep_01  ~boy_sleep_01   ~girl_sleep_01  ~dog_sleep_01
inspect  ~glasses_01+2   ~hanu_wave_01   ~boy_wave_01    ~girl_wave_01   ~dog_sit_01
ask      ~point_01       ~hanu_wave_01   ~boy_wave_01    ~girl_wave_01   ~dog_wave_01+1
startle  ~jump_01        ~hanu_jump_01   ~boy_jump_01    ~girl_jump_01   ~dog_run_02
phone    phone_01        ~hanu_wave_01   ~boy_wave_01    ~girl_wave_01   ~dog_sit_01
crossed  crossed_01      ~hanu_wave_01   ~boy_wave_01    ~girl_wave_01   ~dog_sit_01
splash   splash_01+2     ~hanu_wave_01   ~boy_wave_01    ~girl_wave_01   ~dog_sit_01
thumbsup thumbsup_01     ~hanu_wave_01   ~boy_wave_01    ~girl_wave_01   ~dog_sit_01
glasses  glasses_01+2    ~hanu_wave_01   ~boy_wave_01    ~girl_wave_01   ~dog_sit_01
dance    dance_01+3      ~hanu_wave_01   ~boy_wave_01    ~girl_wave_01   ~dog_sit_01
jump     jump_01         hanu_jump_01    boy_jump_01     girl_jump_01    dog_run_02
lie      ~stand_01       ~hanu_wave_01   ~boy_wave_01    ~girl_wave_01   dog_lie_01
sleep    ~stand_01       hanu_sleep_01   boy_sleep_01    girl_sleep_01   dog_sleep_01
bed      ~stand_01       ~hanu_wave_01   boy_bed_01      girl_bed_01     ~dog_sit_01
```

**Most `~` cells never actually happen**, and it's important to know which do:

- Rows `phone` through `dance` are **flourishes**. A flourish is only ever
  chosen from that character's own `flourishes` weight table, so nobody ever asks
  Hanu for `phone`. Those cells are unreachable through the idle loop — they are
  only reachable through app-reaction moods, which is exactly what the `moods`
  table below exists to prevent.
- Rows `doze`, `inspect`, `ask`, `startle` are the four **boredom-ladder poses**,
  and their `~` cells happen constantly, for every character. That's the whole
  reason `DERIVED_POSES` exists.

---

## Two different fallback systems (don't confuse them)

They solve opposite problems and live in different processes.

| | `DERIVED_POSES` | `moods` |
|---|---|---|
| Where | `renderer/animations.js` | `main.js` `CHARACTERS[key].moods` |
| For | Poses **no character** draws | Poses **some** characters draw |
| Used by | Every pose request, automatically | App-reaction poses only, via `moodFor()` |
| Members | `doze`, `inspect`, `ask`, `startle` | `phone`, `crossed`, `wave`, `dance`, `point` |

**`DERIVED_POSES`** — the boredom ladder needed four poses no sheet draws.
Falling back to `idle` would make all four identical (a dozing pal standing to
attention), so each names substitutes that would read correctly:

```js
doze:    ['sleep', 'lie', 'sit']       // Raj lands on sit — he cannot lie down
inspect: ['glasses', 'crossed', 'idle'] // Raj puts his glasses on to look
ask:     ['point', 'wave']              // Raj points at the Dock
startle: ['jump', 'wave']               // "oh! you're back"
```

**`moods`** — the app-reaction feature (`focusMoods`, off by default) asks for a
pose based on the app you switched to. Raj has all five, so he has no map.
Everyone else needs one, or the reaction would resolve to `idle` and be
invisible:

| Character | phone | crossed | wave | dance | point |
|---|---|---|---|---|---|
| raj | *(direct)* | *(direct)* | *(direct)* | *(direct)* | *(direct)* |
| hanu | sit | sit | wave | jump | wave |
| boy / girl | sit | stretch | wave | jump | wave |
| dog | **lie** | sit | wave | **run** | wave |

`moodFor()` falls back to `'wave'` for anything not in the map.

---

## Flourishes — the idle personality

Weighted random pick during the idle loop (`weightedPick`). Higher = more often.
**Every name here must exist in that character's `animations`**, or it silently
resolves to `idle` and the flourish is invisible.

| Character | Flourish weights |
|---|---|
| raj | phone 3, crossed 3, splash 2, thumbsup 2, glasses 2, sit 2, dance 1, jump 1 |
| hanu | sit 3, wave 2, jump 1 |
| boy / girl | sit 3, wave 2, jump 2, stretch 1 |
| dog | play 4, sit 2, wave 2, lie 2 |

This table is **duplicated** in `main.js` (behaviour) and
`renderer/animations.js` (art). They must agree. The main-process copy is the one
that drives the picking; the renderer copy documents what art backs it.

How long each holds before returning to idle: `FLOURISH_MS` in `state.js`
(`dance` 900, `splash` 400, `phone` 2000, `crossed` 1500, `thumbsup` 1200,
`jump` 500, `glasses` 900, `sit` 2000, `wave` 900, `stretch` 1400, `lie` 2500,
`run` 900; anything else `FLOURISH_DEFAULT_MS`).

---

## Facing — the moonwalk trap

The pal is a single sprite mirrored with CSS. Travel direction alone is not
enough; you also need to know which way the art was drawn:

```js
const nativeSign = getCharacter(key).nativeFacing === 'right' ? 1 : -1;
palEl.style.transform = `scaleX(${facing === nativeSign ? 1 : -1})`;
```

- `raj` and `dog` face **right**. `hanu`, `boy`, `girl` face **left**.
- Assuming all sheets faced right made the left-facing characters walk backwards.
  That was a shipped bug (`MACOS-PORT.md` §2.14).
- **No character has up/down art.** This constrains real behaviour: `facing` only
  flips when horizontal travel exceeds `FACING_EPSILON_PX` (1.5px), so
  near-vertical movement doesn't cause flicker — and it's why the Dock patrol
  uses a stationary `inspect` pose when the Dock is on the left or right edge,
  and `walk` only when it's along the bottom. Using the walk cycle for vertical
  travel is the moonwalk bug on the other axis.

---

## Outfit recolouring

`renderer/recolor.js`. **Raj only** (`recolorable: true`); the setting has no
effect on anyone else.

Six swatches — red `#c23b3b`, blue `#3b62c2`, yellow `#d1b23a`, black `#26262b`,
green `#3f9153`, orange `#d1793a` — plus `default` (no recolour), stored as
`shirtColor` and `pantColor`.

It works per-frame on the canvas, using the bounding box to split the sprite:

| Constant | Value | Why |
|---|---|---|
| `SHIRT_ZONE_FRACTION` | 0.58 | Top 58% of the bbox is shirt, the rest trousers |
| `MIN_ALPHA` | 200 | Ignore soft edges |
| `MAX_SATURATION_SPAN` | 14 | Skip skin and hair — saturated pixels aren't cloth |
| `MIN_GARMENT_LUM` | 25 | Skip near-black shoes and outlines |
| `MAX_GARMENT_LUM` | 215 | Skip near-white highlights and trim |

Results are cached (`frameCache`, `outputCache`), so a colour change is one pass
per frame, not one per animation tick.

---

## Art nothing ever shows

Worth knowing before "fixing" a missing pose that isn't missing:

- **`bed` (boy, girl).** Never displayed by anything. Going to bed means walking
  into the house, and `SLEEPING` **hides the sprite entirely** —
  `palEl.classList.toggle('hidden', s.state === 'SLEEPING')`. The `zzz` you see
  belongs to the house, not the character. `bed` art has no reachable code path.
- **`sleep` (hanu, boy, girl, dog).** Was also unreachable for the same reason.
  The boredom ladder's `doze` rung is the **first and only** thing that displays
  it — he sleeps in his chair, in view, rather than in the house.
- **`dog_walk_01`.** Excluded on purpose (see the dog section).

---

## Asset pipeline

Art arrives as one **reference sheet** per character in `assets/reference/`
(`spritesheet.png` = Raj, `hanusheet.png`, `boysheet.png`, `girlsheet.png`,
`dogsheet.png`, `housesheet.png`). Scripts in `tools/` slice each sheet into
individual 72×72 PNGs (house: 120×120):

| Script | Output |
|---|---|
| `tools/slice-sheet.js` | `assets/pal/` (Raj) |
| `tools/slice-character.js` | `assets/hanu|boy|girl|dog/` |
| `tools/slice-house.js` | `assets/house/` — `OUT_W = 120` |
| `tools/fix-alpha-speckles.js` | Post-pass, seals transparent pin-holes |
| `tools/preview-frames.js`, `inspect-holes.js`, `keying-experiment.js` | Diagnostics |

Each art folder also gets a `manifest.json` recording every frame's name, index,
original bounding box on the sheet, and pixel area. `recolor.js` uses the bbox;
it's also the fastest way to check a slice went where you expected.

**Before touching the slicers, read [`../cosmetic-fix.md`](../cosmetic-fix.md).**
Background keying ate black pixels out of Raj's hair and shirt, showing as white
specks, and the downscale reopened gaps the keying had sealed. The fix is a
two-part backdrop test plus a post-resize hole fill — and it must **not** fill
Scout's leg gaps, which are real. Re-running a slicer naively reintroduces all of
it. `../BUILD_LOG.md` §7 is the rebuild checklist.

---

## Adding a character

Six places, in order. Miss one and the failure is usually silent.

1. **Art** → `assets/<key>/`, 72×72 transparent PNGs, prefixed names
   (`<key>_walk_01`). Slice with `tools/slice-character.js`; check the speckle
   pass.
2. **`renderer/animations.js`** → a `CHARACTERS.<key>` entry: `label`,
   `defaultName`, `dir`, `nativeFacing`, `recolorable`, `flourishes`,
   `animations`. **Look at the sheet** and set `nativeFacing` from what you see.
3. **`main.js` `CHARACTERS`** → `label`, `defaultName`, `flourishes` (matching
   #2), and a `moods` map for every pose in `phone|crossed|wave|dance|point` the
   character lacks.
4. **`renderer/settings.html`** → the character option.
5. **Check the derived poses resolve sensibly** — especially `doze`. A character
   with no `sleep`, `lie` **or** `sit` will doze standing bolt upright.
6. **Verify frames exist** with the script below. A typo'd frame name is a broken
   image at runtime, not an error at startup.

---

## Verifying this document

Every table above is reproducible. From the project root:

```bash
# Every referenced frame exists; every file is referenced.
node --input-type=module -e "
import fs from 'fs';
const m = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync('renderer/animations.js','utf8')));
for (const [k,c] of Object.entries(m.CHARACTERS)) {
  const dir = 'assets/' + c.dir.replace('../assets/','');
  const files = new Set(fs.readdirSync(dir).filter(f=>f.endsWith('.png')).map(f=>f.slice(0,-4)));
  const used = new Set(Object.values(c.animations).flatMap(a=>a.frames));
  console.log(k, 'missing:', [...used].filter(f=>!files.has(f)), 'unused:', [...files].filter(f=>!used.has(f)));
}"
```

Expected today: **no missing files anywhere**, and exactly one unused file —
`dog_walk_01`.

To regenerate the resolution matrix, call `resolveAnimation(key, pose)` for each
character over the pose list in that table.

Last verified against the tree on 2026-09-11.
