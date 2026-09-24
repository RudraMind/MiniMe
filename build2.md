# Build log 2 — session of 2026-09-22

**Addendum, 2026-09-23.** The three files recorded below as uncommitted — `main.js`,
`preload.js`, `test/fetch-sim.js` — are now committed, the working tree is clean, and
`fix/per-frame-facing` is 7 commits ahead of `origin/main`. The `docs/design-swarms/*.jsonl`
transcripts referenced later in this file were removed before publication. Everything
after this note is the record as written on 2026-09-22 and has been left unchanged.

Handoff record. Written so a fresh terminal can pick this up without re-deriving anything.
Everything here was verified against the files on disk at the time of writing, not recalled.

Companion docs: [BEHAVIOUR.md](docs/BEHAVIOUR.md), [CHARACTERS.md](docs/CHARACTERS.md),
[docs/superpowers/specs/2026-09-22-dog-fetch-design.md](docs/superpowers/specs/2026-09-22-dog-fetch-design.md),
[docs/ART-PROMPT-dog-fetch.md](docs/ART-PROMPT-dog-fetch.md).

---

## 1. Where things stand right now

| | |
|---|---|
| Branch | `fix/per-frame-facing` — **`main` was never touched** and still points at `0a9651a` |
| Commits added | 6, listed in section 3 |
| Test suite | `npm test` → **298 checks pass, 0 fail, exit 0** |
| Pixel facing check | `npm run verify:facing` → **63 frame pairs, 0 facing the wrong way** |
| Uncommitted | `main.js`, `preload.js`, `test/fetch-sim.js` — the preload channel fix and its test. Green. Commit or review these first. |
| App | Runs from source (`npm start`). The **packaged bundle in `dist/` is from Sep 9 and is stale** — see section 6. |
| Active character | Switched to **dog** during testing. Switch back from the tray menu if you want another. |

### First thing to do in a new terminal

```bash
cd ~/Claude/projects/MiniMe
git status                  # three files uncommitted, all green
npm test                    # expect 298 pass / 0 fail
npm run verify:facing       # expect 63 pairs / 0 wrong
npm start                   # runs the fixed source; dist/ is stale
```

---

## 2. What was built, in order

### 2.1 Facing — the bug that started it

Reported as: *"boy hanuman and others are walking towards me but the body is going right
completely - left completely every step"*, and *"dog is only one not having issues"*.

**Root cause.** `renderer/chotu.js` mirrors the whole sprite from travel direction and reads
a single `nativeFacing` per character, so every frame of a character must face the same way.
The source sheets do not: within one walk cycle some poses are drawn facing left and some
right. Any cycle mixing both snaps the sprite round on every step. The dog escaped only
because its walk cycle had been hand-picked from same-facing frames and deliberately avoids
`dog_walk_01`, the odd one out on its sheet.

**Two rounds were needed, and the first one was wrong.** Recorded honestly in section 4.

The fix that stands: `tools/frame-facing.js` records the facing of every pose in every source
sheet and *derives* the mirror set from it, replacing a hand-written `flip: [...]` list that
was wrong in both directions at once.

### 2.2 The white outline round the characters

Reported as: *"for all characters boy girl hanuman and dog there is a outline white can we
remove it?"*

Measured before touching anything — share of silhouette edge pixels that were near-white:
**boy 41%, girl 60%, hanu 54%, dog 25%, Raj 0%**. Raj is 0% because his sheet has a dark navy
backdrop; the other four are cut from white sheets.

It was not a drawn outline. It was backdrop that survived keying, because
`tools/slice-character.js` keys white with `TOL = 10` on purpose — a looser tolerance eats
near-white *art* (the boy's cap panel, his socks, the dog's cream fur).

`tools/defringe.js` treats each edge pixel as art colour blended with backdrop at some
coverage, solves for the coverage, and rewrites the pixel as the recovered colour at that
alpha. Result: **boy 41%→2%, girl 60%→4%, hanu 54%→1%, dog 25%→0%**, with 1110 pixels
protected as genuinely white art.

### 2.3 Fetch, for the dog

Designed, approved, then built in two commits. Full design record in
`docs/superpowers/specs/2026-09-22-dog-fetch-design.md`.

The loop: you drag the bone and let go → he sprints out (run frames, 1.9× speed) → one beat
head-down → trots back slower carrying it (0.85×) → drops it at your cursor → sits and stares
until you throw again. One time in five he stops short and makes you wait.

One deliberate change from the original request, agreed in discussion: the bone is dropped at
**your cursor**, not at the house. Two trips made the dog look like a courier and put the
staring beat away from where you are looking. The house is only where the bone parks on first
run.

### 2.4 House art direction — exploration only, nothing built

Ten cozy-escape lo-fi subjects and ten rendering styles, each explored by its own agent, each
ranked by a critic. **No house art was changed.** Outputs preserved in the repo:

- `docs/house-options/index.html` — open in a browser. Ten cards: the mock at real 120px
  scaled 4×, palette swatches, the three states, honest risk, and a paste-ready prompt.
- `docs/house-options/*-120.png` — each mock at true size, which is the honest view.
- `docs/design-swarms/*.jsonl` — the raw agent returns, in case a detail is needed later.

---

## 3. Commits, newest first

| Hash | What |
|---|---|
| `300e4a3` | Bone becomes a real object; four fetch poses cut from the generated sheet |
| `d3522d9` | Fetch state machine, test first |
| `ed38bb7` | White outline removed from the four white-sheet characters |
| `1157352` | **Facing table corrected; facing now checked against pixels rather than itself** |
| `2d3545c` | First facing attempt — superseded by `1157352`, see section 4 |
| `84b4336` | Snapshot of 68 uncommitted files that existed before any of this began |

`84b4336` matters: the working tree held the boredom-ladder work, a re-slice of every pal
frame, and the docs and tests that came with it, none of it recorded anywhere. Re-cutting art
would have destroyed it.

---

## 4. Errors made in this session, and what they cost

Kept deliberately, because each one is a trap the next person can fall into.

### 4.1 The facing table was wrong twice, and the tests could not see it

The first attempt (`2d3545c`) set Raj's `nativeFacing` to `left`. **Raj's sheet faces right** —
`CLAUDE.md`, `docs/CHARACTERS.md`, `cosmetic-fix.md` and `MACOS-PORT.md` all already said so.
That put the reported bug back on the default character, in both directions. It also missed
`boy_walk_02` and `girl_walk_02`, so the walk cycles still snapped.

Why it shipped green: every assertion in `test/facing-sim.js` was derived from the same table
it was meant to check, and `tools/verify-facing.js` re-cut the sheets using mirrors derived
from that same table. It reported **76/76 correct on a tree with seven frames facing the wrong
way**. A circular check is worse than no check, because it reads as coverage.

**Fixed by:** deleting the vacuous assertion (with a comment saying why), and rewriting
`verify-facing.js` so it never reads the table — it compares the frames of each animation to
each other in pixels. Red-green proved: 9 failures on the old art, 0 on the new.

### 4.2 Reading small images is unreliable, and it caused every wrong entry

Facing was misread repeatedly from contact sheets and 5-tile strips. What actually works:
**one frame at a time, zoom 12 or a head crop at 14×**. Several entries were corrected only
after switching to that. If you touch facing, use that method.

### 4.3 The in-place mirror damaged geometry

The first mirror pass trimmed each figure, flipped it, and re-centred it. That **lost a column**
from `boy_walk_03` and `boy_stretch_01` and pushed `pal/point_01` and `pal/sit_01` **one pixel
down**, so Raj sank when he sat. Replaced with a full-canvas flip, which cannot do either, and
row extent plus canvas size are now asserted unchanged per frame.

### 4.4 The bone prop was written at the wrong scale

Written at **sheet scale (63×59)** instead of sprite scale. The slicer downscales figures to a
72px canvas, so a bone left at sheet scale renders about five times too large — nearly as big
as the dog. Now written at **22×20**, with the sheet-scale copy kept only for compositing into
the sheet.

### 4.5 The bone could not be dragged, and nothing said so

`preload.js` whitelists the channels the renderer may send, and `bone:drag` / `bone:dragend`
were missing. `send()` drops unknown channels **silently, with no error anywhere**. The bone
appeared to move, because the renderer repositions the element itself for responsiveness, then
snapped back on release because the main process never heard about the drag.

Guarded now: `test/fetch-sim.js` scans `renderer/chotu.js` for every channel it sends,
including the template-literal ones, and checks each against the preload list.

### 4.6 Smaller ones

- `#bone` in `chotu.css` was `pointer-events: none` — correct while the bone was decoration,
  fatal once it had to be grabbed.
- `node -e "require('./tools/slice-character.js')"` **ran the slicer** and overwrote art,
  because it had no `require.main` guard. Both slicers are guarded now.
- The brief sent to the design agents said the pipeline keys a white backdrop. That is true of
  the character sheets and **false for the house** — see 5.1. An agent caught it.
- The first options page wrote every option to the same `option.png`, because the agents did
  not echo a key field. Slugs now come from the name.

---

## 5. Findings worth keeping

### 5.1 The house is keyed on dark navy, not white

`tools/slice-house.js:22` → `BG = [12, 19, 30]`, `TOL = 25`, `OUT_W = 120`, resize with
`kernel: 'nearest'`. The character slicers key white; the house slicer keys navy. Any art
prompt for the house that asks for a white backdrop is wrong, and the real hazard there is
**near-black night pixels being eaten**, not white leaking in.

### 5.2 `nearest` point-samples, it does not average

The house source bbox is ~471px and the output is 120 — a ratio of **3.925**, not an integer.
Nearest at a fractional ratio keeps roughly one source pixel in sixteen. Consequences:

- Fine texture is not softened into mush, it is randomly kept or dropped — **speckle, not
  blur**. Crayon and pencil styles lose their identity.
- Any stroke thinner than about 8 source pixels dashes.
- True pixel art cannot survive unless each source state is an exact multiple of 120 wide.

### 5.3 Each house state is cropped to its own bounding box

`slice-house.js` crops each state to its own ink bbox and bottom-centres it on a shared canvas
sized from the widest state. **If the three states differ in extents at all, the whole building
shifts between frames.** A sliding door keeps extents identical; a swinging door does not.

### 5.4 The character slicer has no hole repair

`slice-sheet.js` (Raj) fills enclosed alpha holes inline. `slice-character.js` does not —
`tools/fix-alpha-speckles.js` is a separate step. So a bare re-cut of a character sheet
regresses alpha on frames that had been repaired. Ten frames were affected when this was
measured. **Re-cut, then run the repair.**

### 5.5 The halo fix does not cover the house

`tools/defringe-frames.js` restricts itself to `['hanu', 'boy', 'girl', 'dog']`. The house is
not in that list and `slice-house.js` writes binary alpha, so **any house style with a soft
outer edge ships as an opaque pale ring**. Also note `defringe.js` is deliberately not
idempotent — a second run erodes the sprite, and `alreadyDefringed()` exists to refuse that.

### 5.6 Props painted into frames make those frames single-use

`dog_drink_01` has a water bowl painted in; `dog_sleep_01` has a pillow. Neither can be reused
as a generic head-down pose. This is why fetch needed new art rather than reusing what existed.

### 5.7 The pet stands in front of the house's best pixels

`houseDoor()` puts the pet at `house.x + 24`, `house.y + 48`, and the pet is 72px. So a 32×72
rectangle at the bottom centre of the house is **covered whenever the pet is at the door**. Most
of the ten design directions put their biggest warm shape exactly there.

### 5.8 Interior see-through pixels are pre-existing

New fetch frames carry 3–81 interior partially-transparent pixels where the generated art's
outline is thin. Existing art has the same trait — `dog_run_02` has 49, at alpha 0. Recorded as
a nit, not introduced by this work.

---

## 6. The packaged app in `dist/` is stale

The running app was `dist/mac-arm64/MiniMe.app`, whose `app.asar` was built **Sep 9**. It loads
its own frozen copy of the code and art, so editing the source changed nothing and restarting
it changed nothing. This wasted a diagnostic cycle.

- To see source changes: `npm start`.
- To refresh the bundle: `npm run pack:mac` — quit the running app first, it overwrites the
  same bundle. `dist/` is gitignored.

---

## 7. Code changes, file by file

### New files

| File | Purpose |
|---|---|
| `tools/frame-facing.js` | Ground truth: which way every source pose faces, per character, plus `flipSet()` and validation that refuses values it does not understand |
| `tools/verify-facing.js` | Pixel check that **never reads the facing table**: compares the frames of each animation to each other, flags any pair that is a mirror of the other |
| `tools/defringe.js` | White-spill removal for edge pixels, with a contrast guard that protects genuinely white art, plus `alreadyDefringed()` |
| `tools/defringe-frames.js` | Applies the above to shipped frames; dry run by default, `--apply` to write |
| `tools/build-fetch-sheet.js` | Assembles `assets/reference/dogfetchsheet.png` from the generated source, compositing the bone at recorded offsets |
| `test/facing-sim.js` | Table-level guards: `nativeFacing` matches the recorded target, completeness both ways, animations non-empty, derived mirror sets, validator rejects bad values |
| `test/fetch-sim.js` | The fetch loop headless, plus the preload channel guard |
| `docs/superpowers/specs/2026-09-22-dog-fetch-design.md` | Fetch design record |
| `docs/ART-PROMPT-dog-fetch.md` | The art prompt used, with the pipeline constraints and the reason for each |
| `docs/house-options/`, `docs/design-swarms/` | House exploration outputs |

### Modified

| File | Change |
|---|---|
| `state.js` | Four fetch states, `throwBone()`, `placeBone()`, `_beginCarry()`, `_dropBone()`, `_abandonFetch()`; `cfg.character`; bone in `serialize()`; fetch states added to the reminder-interruptible list |
| `main.js` | `bonePos` in the store; `bonePosition()` / `commitBonePos()`; `bone:drag` / `bone:dragend`; character passed into `PalState`; bone converted to window coords in the snapshot; `MINIME_DEBUG_FACING=1` tracing and window capture |
| `renderer/chotu.js` | Bone drawn from the snapshot and hidden while carried; `dragTarget` gains `'bone'`; hit box padded 8px; `BONE_W`/`BONE_H` |
| `renderer/chotu.css` | `#bone` resized 24px → 22×20 and `pointer-events` none → auto |
| `renderer/animations.js` | Raj `nativeFacing` restored to `right`; dog gains `carry`, `pickup`, `hold` |
| `preload.js` | `bone:drag`, `bone:dragend` whitelisted, with a comment explaining the silent-drop trap |
| `tools/slice-character.js` | Mirrors derived from `frame-facing.js`; defringe wired in after the downscale; `outKey` so one character can span two sheets; `require.main` guard |
| `tools/slice-sheet.js` | Mirror support (Raj had none); `require.main` guard |
| `package.json` | `facing-sim` and `fetch-sim` in `npm test`; new `verify:facing` and `defringe` scripts |
| 21 art files | 17 frames mirrored to match the facing table, 45 defringed, 4 new fetch frames |

---

## 8. Open decisions and next steps

### Needs your call

1. **Which house direction**, from `docs/house-options/index.html`. Critic's order was: Still Up
   (attic dormer) 1, The Siding (train carriage) 2, Last Bowl (noodle stall) 3. It recommended
   dropping Kettle Van and Dusk Glasshouse. **Gouache storybook** won the separate style vote,
   on the grounds that opaque paint cannot bleed so the keying cannot eat it.
2. **White or navy backdrop** for any new house art. This flips the risk table: on the navy
   path, stained-glass lead and neon ink both fall inside tolerance 25 and the dark border that
   was supposed to protect them is the thing keyed away.
3. Three fetch parameters, currently set to the proposals in the design doc: stare for 6s
   before giving up, tease one time in five, no fetch for the other four characters.

### Ready to do

4. **Throw the bone.** The drag path has never been exercised by a human. The state machine is
   tested and the prop is confirmed drawn on screen, but nobody has watched the loop run.
5. Commit the three uncommitted files.
6. Decide whether `fix/per-frame-facing` merges to `main`, and whether to rebuild `dist/`.

### Known nits, recorded not fixed

7. Interior see-through pixels (5.8) — shared with existing art.
8. Trapped white pockets *inside* character silhouettes, 8–28 px per frame, from backdrop
   sealed inside the shape by dark linework. Three separation rules were tried and all three
   failed: colour purity (the sheet backdrop is not flat, min channel 245), size ≥ 400px (also
   lands on hanu's pillow, which is real art), and light-path reachability (finds only 340 of
   16,927). **There is no safe automatic rule from these sheets.** Left alone deliberately.
9. `npm run assets` does not include `slice-character.js` at all, and no script chains the
   repair pass after a re-cut.

---

## 9. Commands worth knowing

```bash
npm test                        # 298 checks: ladder, play, facing tables, fetch loop
npm run verify:facing           # pixel check, never reads the facing table
npm run verify:facing -- --assets /path/to/other/assets   # point it at another tree
npm run defringe                # dry run; add --apply to write
node tools/build-fetch-sheet.js # rebuild the fetch sheet from the generated source
node tools/slice-character.js dogfetch   # cut just the fetch sheet
node tools/fix-alpha-speckles.js --dry assets/dog        # hole repair, dry run
MINIME_DEBUG_FACING=1 npm start # trace travel vs facing; saves cropped sprite shots and one
                                # full-window shot to /tmp/minime-*.png
```

### How to verify art by eye, reliably

```bash
node tools/preview-frames.js /tmp/one.png 12 assets/dog/dog_carry_01.png   # ONE frame, zoom 12
```

One frame per image. Contact sheets and 5-tile strips produced wrong readings repeatedly in
this session; single frames at high zoom did not.
