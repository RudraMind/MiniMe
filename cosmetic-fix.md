# Cosmetic fixes — transparent holes in the sprite art

Self-contained record of two visual defects found and fixed in MiniMe's sprite
art. Neither is macOS-specific: both were present in the shipped assets and
affected Windows identically. They were simply *noticed* while porting to macOS.

The port itself is documented separately in [`MACOS-PORT.md`](MACOS-PORT.md);
this file is the art side of it, and assumes no knowledge of that document.

- [1. What was visible](#1-what-was-visible)
- [2. Why a hole shows as a white speck](#2-why-a-hole-shows-as-a-white-speck)
- [3. Measuring it first](#3-measuring-it-first)
- [4. Root cause: the background keying ate the black art](#4-root-cause-the-background-keying-ate-the-black-art)
- [5. Secondary cause: the downscale reopens sealed gaps](#5-secondary-cause-the-downscale-reopens-sealed-gaps)
- [6. The fix](#6-the-fix)
- [7. The other four character sheets](#7-the-other-four-character-sheets)
- [8. Results](#8-results)
- [9. How to re-verify](#9-how-to-re-verify)
- [10. Files changed](#10-files-changed)
- [11. Corrections to earlier claims](#11-corrections-to-earlier-claims)
- [12. Also fixed: Raj walked backwards](#12-also-fixed-raj-walked-backwards)

---

## 1. What was visible

Raj — the default character, internal key `raj`, default name *Chotu* — appeared
with **white specks stippled through his black hair** instead of solid black,
and with **white gashes torn through his black T-shirt**. On some poses
(`phone_01`, `stretch_03`) the shirt damage was the worse of the two: a hole
several pixels across, straight through the chest.

His grey trousers, white shoes, skin and blue wristband looked correct
throughout. That asymmetry turned out to be the entire diagnosis — see §3.

---

## 2. Why a hole shows as a white speck

MiniMe draws the character in a transparent, frameless, always-on-top window.
There is no backdrop of its own behind the sprite, so a fully transparent pixel
*inside* the silhouette does not read as black, or as nothing — it shows
whatever is behind the window. Against a light desktop or a white document that
is a white dot.

So this class of bug is invisible in an image viewer that shows transparency as
white or as a checkerboard, and invisible against a dark desktop. It only
appears in use. Throughout this work the frames were inspected composited over
**magenta**, a colour that appears nowhere in any of the five palettes, so that
anything pink is unambiguously a hole rather than art
(`tools/preview-frames.js`).

---

## 3. Measuring it first

Before changing anything, every enclosed transparent region in all 31 Raj frames
was catalogued with its area, bounding box, height on the sprite, and the
dominant opaque colour bordering it (`tools/inspect-holes.js`).

"Enclosed" means transparent pixels **not reachable from the frame edge** by a
4-connected flood fill. This distinction matters: Raj's art contains plenty of
legitimate see-through space — the triangle under a raised arm in `stretch_03`,
the gap between his legs mid-stride — but all of it opens to the frame edge.
Only sealed pockets are suspect.

**Result: 60 enclosed regions, 684 hole pixels, across 27 of the 31 frames.**

Classified by height on the 72px frame:

| Band | Body region | Regions | Hole px |
|---|---|---|---|
| `y/H < 0.18` | head — hair and sunglasses | 38 | 441 |
| `0.18 – 0.62` | black T-shirt and torso | 22 | 243 |
| `> 0.62` | **grey trousers, white shoes** | **0** | **0** |

And classified by the colour surrounding each hole:

| Surrounding colour | Regions | Hole px | Share |
|---|---|---|---|
| Near-black neutral (max channel ≤ 80, spread ≤ 14) | 57 | 639 | **93%** |
| Anything else | 3 | 45 | 7% |

**The zero is the finding.** The damage is not distributed over the sprite, and
it is not random. It falls almost exclusively on the near-black art — hair and
black T-shirt — and the light-coloured lower half of the same character, cut
from the same sheet by the same code in the same pass, has *not a single hole*.
Whatever caused this is colour-dependent, not geometric.

---

## 4. Root cause: the background keying ate the black art

`tools/slice-sheet.js` cuts the 31 Raj frames out of
`assets/reference/spritesheet.png`. That sheet is a 1536×1024 RGB image with **no
alpha channel** — the characters sit on a flat backdrop, and the slicer has to
key it out by colour:

```js
const BG = [23, 29, 38];   // a dark navy
const TOL = 40;            // Manhattan distance
```

`[23, 29, 38]` is a dark navy. Raj's hair and shirt are near-black. Several of
their tones fall **inside** that tolerance:

| Colour | Manhattan distance to `BG` | Inside `TOL = 40`? |
|---|---|---|
| `(19, 21, 22)` hair mid-tone | 4 + 8 + 16 = **28** | **yes — keyed as background** |
| `(13, 13, 14)` hair shadow | 10 + 16 + 24 = 50 | no |
| `(44, 45, 44)` hair highlight | 21 + 16 + 6 = 43 | no |
| `(2, 4, 4)` outline | 21 + 25 + 34 = 80 | no |

The slicer does have a guard against exactly this. It does not delete every
pixel that merely *looks* like the backdrop; it flood-fills inward from the
sheet border and deletes only backdrop-coloured pixels **reachable from
outside**. Its own comment explains why:

> A pixel is only "true background" if it's reachable from the sheet's outer
> border through other background-colored pixels. This keeps dark interior
> shading (cap creases, collar shadow) opaque even when its color happens to be
> close to the flat backdrop.

That guard is sound, and it is why the bug is subtle rather than catastrophic.
But it cannot help here, because **the hair is the outermost part of the
silhouette.** There is no opaque barrier between the backdrop and the top of
Raj's head, so the fill walks straight in through the hair's in-tolerance tones
and hollows it out from the outside. The same happens along the shirt's edges
and into the gaps between arm and torso.

Rendering the *source-resolution* mask — before any cropping or resizing —
showed the scale of it: roughly a **third of the hair mass** was being
classified as background, leaving a shredded remnant of scattered black pixels
where a solid hairstyle should be.

`closeAlpha()` (a morphological dilate-then-erode, radius 2) then runs and
patches most of that back. **That is why the shipped frames looked only slightly
wrong instead of obviously broken** — the specks users saw were the residue the
closing could not reach, not the whole of the damage.

---

## 5. Secondary cause: the downscale reopens sealed gaps

There is a second, smaller mechanism, and it is worth stating separately because
it was initially mistaken for the whole problem (see §11).

`closeAlpha()` runs at **source resolution**. The frame is only afterwards
downscaled to fit the 72px canvas — about 3× — with:

```js
.resize(outW, outH, { kernel: 'nearest', fit: 'fill' })
```

Nearest-neighbour resampling of a binary alpha mask does not average anything;
it picks one source pixel per destination pixel. A gap that closing had just
sealed to a 1px seam can be re-selected as transparent in the downscaled frame.
So holes can reappear *after* the defence against them has already run.

This accounts for **75 of the 684** hole pixels — real, but not the cause of
the reported defect.

---

## 6. The fix

### 6.1 A two-part backdrop test

Simply tightening `TOL` does not work, and the slicer proves it. See §8 — at
`TOL = 8` enough backdrop survives *between* neighbouring sprites on the sheet
that the connected-component pass merges them, and the slicer's own guard
rejects the run:

```js
if (filtered.length !== 31) {
  console.error(`FATAL: expected exactly 31 components after filtering, got ${filtered.length}.`);
```

The loose tolerance is therefore load-bearing: it exists to erase the
antialiased rim where the backdrop blends into the art, and without that the
sprites stay connected.

What separates backdrop from hair is not distance but **hue**. The backdrop is
a blue-dominant navy; Raj's near-black art is neutral:

| | `b - r` |
|---|---|
| `BG` = `(23, 29, 38)` backdrop | **+15** |
| `(19, 21, 22)` hair | +3 |
| `(13, 13, 14)` hair | +1 |
| `(44, 45, 44)` hair | 0 |

So keep the loose distance, but outside a tight core require the backdrop's blue
cast as well:

```js
const TOL      = 40;   // loose distance, still needed for the antialiased rim
const TOL_CORE = 10;   // this close to BG, it is backdrop regardless
const BG_CAST  = 6;    // beyond that, require the backdrop's blue cast

function isBgColor(r, g, b) {
  const d = bgDiff(r, g, b);
  if (d <= TOL_CORE) return true;
  return d <= TOL && (b - r) >= BG_CAST;
}
```

The rim keeps working because the rim *is* part backdrop — it carries the blue
cast and is still removed. Neutral dark art no longer is.

A stricter variant (`TOL_CORE = 8`, `BG_CAST = 8`) removes marginally more holes
but was **rejected on inspection**: it retains too much of the rim and leaves
visible dark navy smears between Raj's raised hand and his head in `wave_02`,
and behind the bottle in `drink_01`. Fewer holes, worse picture. The numbers
alone would have chosen it, which is why the frames were looked at.

### 6.2 A post-resize hole fill

For the residual 75px from §5, `fillEnclosedHoles()` now runs on the
**downscaled** frame, after the resize. It fills transparent pixels unreachable
from the frame edge by growing colour inward from the rim, one ring per pass,
each pixel taking the **most common** opaque colour among its eight neighbours.

Most-common, not a single flat fill and not an average, for two distinct
reasons: larger holes straddle hair and skin, so one flat tone would stamp a
skin-coloured blob into the hair; and averaging black hair against skin would
invent a grey that exists nowhere in the palette.

Being restricted to *enclosed* pixels is what makes this safe to apply
unconditionally to Raj: his genuine see-through gaps all open to the frame edge
and are never reached.

---

## 7. The other four character sheets

Hanu, Bud, Pip and Scout come from `tools/slice-character.js`, a **different**
slicer, which was not modified. They were scanned anyway and were far less
affected, so they are repaired in place by `tools/fix-alpha-speckles.js` rather
than by re-slicing:

| Sheet | Hole px repaired |
|---|---|
| `assets/pal` (Raj) | 684 — *fixed at source instead, see §6* |
| `assets/dog` (Scout) | 43 |
| `assets/boy` (Bud) | 22 |
| `assets/girl` (Pip) | 2 |
| `assets/hanu` (Hanu) | 1 |

### Scout's leg gaps must not be filled

`tools/fix-alpha-speckles.js` caps region area **per sheet**, because Scout's
art contains *intentional* enclosed transparency. When a paw lands it closes off
the wedge between his legs, producing sealed pockets of 15–82px that are real
negative space. Filling them would web his legs together into a solid blob.

Verified by rendering all of them over magenta and looking: the large enclosed
regions in the dog frames are the gaps between his legs. Raj, Hanu, Bud and Pip
have no intentional interior holes at all.

| Sheet | Cap | Rationale |
|---|---|---|
| `pal`, `hanu`, `boy`, `girl` | none — fill every enclosed region | no intentional interior holes |
| `dog` | 8px | preserves the 15–82px leg gaps, still clears the 1–8px cracks |

**This cannot be replaced by a cleverer heuristic**, which is why it is an
explicit table:

- *Size* does not separate them. Raj's hair holes run 1–34px; Scout's legitimate
  gaps run 15–82px. They overlap.
- *Shape* does not reliably separate them either, and a **morphological closing
  was measured to bridge Scout's leg gaps in all 12 of his frames even at
  radius 1.**
- The information that distinguishes "hole in hair" from "gap between legs"
  simply is not present in a 72px alpha mask. It exists only in the source art.

Which is the deeper reason Raj was fixed at the keying step rather than patched:
for him, the ground truth was available.

---

## 8. Results

Component count must stay at exactly 31 or the slicer aborts. Hole pixels are
the enclosed-region total across all 31 Raj frames.

| Keying | Raw components | Filtered (must be 31) | Hole px | Verdict |
|---|---|---|---|---|
| Shipped — `TOL = 40` alone | 477 | 31 | **684** | the reported bug |
| Naive tighten — `TOL = 8` | 281 | **26** | — | **aborts: sprites merge** |
| Two-part test | 184 | 31 | 75 | good |
| Two-part test + post-resize fill | 184 | 31 | **0** | **shipped** |

Raw components dropping from 477 to 184 is itself a signal: the keying had been
shattering the hair into scattered fragments, and those fragments were being
counted as components before the size filter discarded them.

After the fix, across **all five** character sheets, the only enclosed
transparency remaining anywhere is **8 regions / 307px, all in `assets/dog/`** —
Scout's intentional leg gaps.

### A side benefit

Because the keying had been eating roughly a third of Raj's hair, restoring it
does more than remove specks: his hair is now **fuller and rounder, and closer
to the source sheet than the original release ever was.** The white nick on the
shirt in `walk_04` and the gashes in `phone_01` and `stretch_03` are likewise
gone rather than merely reduced.

---

## 9. How to re-verify

Requires the optional `sharp` dependency (`npm install sharp`).

**Confirm no sprite has holes:**

```sh
node tools/inspect-holes.js assets/pal assets/dog assets/boy assets/girl assets/hanu
```

Expect exactly `8 enclosed regions, 307px total`, every one of them under
`assets/dog/`. **Any region reported in `assets/pal/` is a regression.**

**See it rather than count it** — magnified over magenta, so any pink is a hole:

```sh
node tools/preview-frames.js /tmp/pal.png 8 assets/pal/stand_01.png assets/pal/walk_0*.png
```

**Re-derive the comparison table in §8**, without touching `assets/`:

```sh
node tools/keying-experiment.js /tmp/k/current current 10 40 6   # -> filtered=31
node tools/keying-experiment.js /tmp/k/tight   tight   8  40 6   # -> filtered=26, aborts
node tools/keying-experiment.js /tmp/k/cast    cast    10 40 6   # -> filtered=31
node tools/inspect-holes.js /tmp/k/current | tail -2              # -> 60 regions, 684px
node tools/inspect-holes.js /tmp/k/cast    | tail -2              # ->  6 regions,  75px
```

The `current` row reproduces the shipped assets exactly at 684px. That is what
establishes the harness is faithful before the other rows are trusted.

**Regenerate Raj's frames from the sheet:**

```sh
npm run slice
```

Expect `Filtered components: 31` and `Patched 75 enclosed transparent pixel(s)
after downscaling.` The frames are deterministic — re-running reproduces them
byte for byte.

**Compare against the original art at any time.** All frames are tracked in
git, so `git diff -- assets` shows exactly which changed and
`git checkout -- assets` restores the originals wholesale.

---

## 10. Files changed

Code:

```
 tools/slice-sheet.js   | 113 +++++++++++++++++++++++++++++++++++++++-
```

Two changes: `isBgColor()` replacing the bare `TOL` comparison (§6.1), and
`fillEnclosedHoles()` applied after the resize (§6.2).

New tools:

```
 tools/fix-alpha-speckles.js   repairs enclosed holes in place, per-sheet caps (§7)
 tools/inspect-holes.js        diagnostic: catalogues every enclosed hole
 tools/preview-frames.js       diagnostic: magnifies frames over magenta
 tools/keying-experiment.js    diagnostic: compares keying rules off to one side
```

None of these ship — `package.json` excludes `tools/**` from packaging. The
three diagnostics are kept because the measurements above are otherwise
unreproducible.

Regenerated / repaired assets — 42 files, binary:

```
 assets/pal/*.png            31 frames, re-sliced with the corrected keying
 assets/pal/manifest.json    re-emitted by the slicer; bounding boxes unchanged
 assets/dog/*.png             6 frames, cracks filled in place
 assets/boy/*.png             2 frames
 assets/hanu/*.png            1 frame
 assets/girl/*.png            1 frame
```

Not modified: `tools/slice-character.js`, `tools/slice-house.js`, the reference
sheets in `assets/reference/`, and all application code.

### This ships to Windows too

`tools/slice-sheet.js` has no platform branches and the assets are not
per-platform. These defects were present on Windows and are fixed there
equally. Anyone merging should be aware the change includes 42 regenerated
binary assets.

---

## 11. Corrections to earlier claims

Recorded so the reasoning is not misleading to whoever reads this next.

1. **The specks were first attributed to the nearest-neighbour downscale. That
   was a secondary cause, not the primary one.** The initial diagnosis was §5
   alone — `closeAlpha()` running before the resize. That mechanism is real and
   accounts for 75 of 684 hole pixels, which is why `fillEnclosedHoles()` was
   added. But it is not what caused the reported bug. The primary cause is §4,
   and it was only visible by rendering the **source-resolution** mask, which
   showed a third of the hair already gone before any resizing had happened.
   The first plausible mechanism was accepted without inspecting the earliest
   stage of the pipeline.

2. **The first repair attempt used the wrong discriminator.** It filled holes by
   counting opaque neighbours (`≥ 6 of 8`), which catches isolated pixels but
   not 2–3px pockets; it reached only 65 of 684 pixels. Replaced by proper
   connected-component analysis of enclosed regions.

3. **An area threshold was initially assumed to be enough to protect Scout's leg
   gaps.** It is not, in general — the size ranges overlap (§7). The per-sheet
   cap works only because it is paired with the fact, established by looking at
   the frames, that four of the five sheets have no intentional interior holes
   at all.

---

## 12. Also fixed: Raj walked backwards

A second cosmetic defect, unrelated in mechanism but found in the same pass and
also cross-platform.

The renderer mirrors a sprite by comparing travel direction against the art's
declared facing (`renderer/chotu.js`):

```js
const nativeSign = getCharacter(characterKey).nativeFacing === 'right' ? 1 : -1;
palEl.style.transform = `scaleX(${facing === nativeSign ? 1 : -1})`;
```

In `renderer/animations.js`, `raj` declared `nativeFacing: 'left'`, but **Raj's
art faces right** — sunglasses and nose on the right, back of the head on the
left. Because the comparison is symmetrical, a wrong declaration inverts the
sprite in *both* directions, so Raj moonwalked constantly rather than only one
way.

```diff
  // renderer/animations.js, the raj entry
- nativeFacing: 'left',
+ nativeFacing: 'right',
```

All five sheets were checked, to avoid trading one wrong declaration for
another. **Only `raj` was wrong:**

| Character | Art faces | Declared | Verdict |
|---|---|---|---|
| raj | right | ~~left~~ → right | **was wrong, fixed** |
| hanu | left | left | correct |
| boy (Bud) | left | left | correct |
| girl (Pip) | left | left | correct |
| dog (Scout) | right | right | correct |

Worth noting: the most recent commit in this repository (`0a9651a`) is titled
*"Fix backwards walking, add the dog's idle play."* That pass evidently
corrected the four other characters and left the default one inverted — which is
likely why the bug survived. It looks like already-fixed territory.
