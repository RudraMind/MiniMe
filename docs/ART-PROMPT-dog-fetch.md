# Art prompt — dog fetch sheet

A paste-ready prompt for generating the eight new dog poses the fetch behaviour
needs. Everything in it is measured from `assets/reference/dogsheet.png` and from
what `tools/slice-character.js` requires of a sheet, so the result drops into the
existing pipeline instead of needing rework.

Companion docs: [CHARACTERS.md](CHARACTERS.md), [BEHAVIOUR.md](BEHAVIOUR.md).

## Why each constraint is in the prompt

| Constraint | Where it comes from |
|---|---|
| Pure `#FFFFFF` background, flat | `tools/slice-character.js` keys white with `TOL = 10`. A gradient or a tint outside that tolerance survives as an opaque halo. |
| No drop shadows, no dust puffs | The slicer strips shadows with a brightness/saturation heuristic confined to the bottom 30% of each figure. Art without them needs no heuristic and cannot be mis-detected. |
| Dark outline on every shape | The backdrop flood is blocked by dark linework. That is what stops it leaking into the figure and eating near-white art. |
| Figures fully separated, none touching | The slicer finds figures as connected components and asserts the count. Two touching poses merge into one and the run fails. |
| All directional poses face RIGHT | `renderer/animations.js` declares `nativeFacing: 'right'` for the dog, and `renderer/chotu.js` mirrors the whole sprite from travel direction. One facing per character is the rule. |
| The bone is biscuit-brown, not cream | Measured: the existing cream bone composited on the dog's muzzle lands 114 pixels exactly where intended and is invisible, because the dog is cream too. Contrast has to come from the art. |
| Figure heights 210–290 px | Measured range of the twelve existing figures (238–349 wide, 212–290 tall) at sheet scale, before the slicer downscales each to a 72 px canvas. |

## Attach this image with the prompt

`assets/reference/dogsheet.png` — 1536 × 1024, 1.9 MB, the twelve existing poses.

Absolute path:

```
~/Claude/projects/MiniMe/assets/reference/dogsheet.png
```

Attach it rather than relying on the written description alone. The description
exists so that a model which ignores the reference still produces something close,
but the sheet is what actually pins the character design, the shading, the outline
weight, the figure scale and the spacing. Send the image and the prompt together in
the same message.

## The prompt

Copy everything between the lines.

---

The attached image is an existing sprite sheet of twelve poses of a cartoon puppy.
I need eight NEW poses of the same puppy, drawn to match that sheet exactly — same
character, same style, same shading, same outline weight, same scale — so the new
poses can sit beside the old ones without looking out of place. Match the attached
image first; the description below is there to remove any ambiguity, not to replace
what you can see.

**Output format**

- One PNG image, 1536 × 768 pixels.
- A 4 column × 2 row grid of poses, in the order I list below, left to right, top
  row first.
- Background pure white, hex `#FFFFFF`, completely flat: no gradient, no paper
  texture, no vignette, no coloured tint anywhere.
- Each figure roughly 240–320 px wide and 210–290 px tall, centred in its own
  grid cell, with at least 60 px of clean white between any two figures and
  between every figure and the image edge.
- No drop shadows. No ground shadow. No contact shadow. No dust clouds, no motion
  puffs, no speed lines, no sparkles.
- No text, no labels, no numbers, no frame borders, no grid lines, no watermark,
  no signature.
- Every figure fully inside its cell; nothing cropped, nothing overlapping.

**Style**

- Soft painted cartoon illustration with gentle airbrush shading, not flat vector
  and not pixel art.
- A dark brown outline around every shape and every internal edge — the fur
  silhouette, the cap, the scarf, the bone. The outline must be continuous and
  clearly darker than anything it encloses.
- One consistent light source, from the upper left, on all eight poses.
- Identical character proportions, identical colours and identical scale in all
  eight poses.

**The character, the same in every pose**

- A small fluffy puppy, Maltese crossed with Shih Tzu: cream and apricot-tan fur,
  a paler cream muzzle, chest and paws, warmer tan on the back, ears and tail.
- Big round dark brown eyes with a small white catchlight. A small dark brown
  nose. A pink tongue when the mouth is open.
- A red baseball cap worn slightly tilted back on the head, with a blue underside
  to the brim and a dark navy band where the brim meets the crown.
- A blue and white gingham check scarf around the neck, with short fringed ends
  hanging down.
- A fluffy tail carried up and curled over the back.

**The bone prop**

- A classic two-lobed dog bone.
- Biscuit brown — a warm mid-tan, clearly darker than the puppy's cream fur — with
  the same dark brown outline as everything else. This matters: a cream bone
  disappears against cream fur, and the whole point of these poses is that the
  bone is visible.
- The same bone, same size and same colour, in every pose that contains it.

**The eight poses, in this exact order**

1. Trotting to the RIGHT in side profile, carrying the bone crosswise in its
   mouth. Front legs planted, back legs mid-stride — the contact beat of a walk.
   Head level, eyes forward along the direction of travel.
2. Trotting to the RIGHT in side profile, carrying the bone crosswise in its
   mouth, at the opposite point of the same cycle: legs extended, body slightly
   lifted, as though between steps. Same head position and same bone position in
   the mouth as pose 1.
3. Head lowered to the ground, facing RIGHT, nose at a bone lying on the floor,
   in the act of picking it up. The bone rests on the ground, not yet in the
   mouth. No bowl, no dish, no mat, no cushion, no water — nothing on the floor
   but the bone.
4. Sitting, body square to the viewer, looking straight out at the viewer, with
   the bone held crosswise in its mouth. Ears up, eyes wide and eager.
5. Sitting, body square to the viewer, looking straight out at the viewer, with
   nothing in its mouth. Mouth closed, ears up, eyes locked on the viewer,
   whole posture alert and expectant — waiting to be thrown something.
6. Standing facing RIGHT in side profile, head lowered, with the bone lying on
   the ground just in front of its nose, as though it has this moment dropped it.
   Mouth open and empty.
7. Running fast to the RIGHT in side profile, carrying the bone crosswise in its
   mouth. All four legs off the ground, body stretched, ears back. No dust and no
   motion lines — the speed must read from the pose alone.
8. The bone on its own, no puppy: a single biscuit-brown bone, the same bone as in
   the other poses, drawn at the same scale, lying flat and horizontal, centred in
   its cell on white.

---

## After the image comes back

Check these before wiring it in, because each one is a failure the slicer cannot
recover from on its own:

1. Exactly eight separate figures, none touching another and none touching the
   edge.
2. Background is genuinely `#FFFFFF` and flat. Sample a few spots far apart; a
   near-white gradient is the most common failure and it survives keying as a
   visible halo.
3. No shadows and no puffs. If they arrived anyway, they will be treated as
   figures or as shadow, and either way the frame count assertion may fail.
4. All of poses 1, 2, 3, 6 and 7 face right. A single left-facing pose reintroduces
   the bug this project already fixed twice: the sprite snaps round mid-cycle.
5. The bone reads clearly against the fur. Hold the image at a small size — if the
   bone vanishes into the muzzle, the colour is still too close and the sheet
   needs regenerating with a darker bone.
6. Pose 3 contains no bowl, dish or cushion. The existing `dog_drink_01` and
   `dog_sleep_01` frames are unusable for anything else precisely because their
   props are painted into the frame, and that is the mistake to avoid repeating.

Then save it as `assets/reference/dogfetchsheet.png` and add a spec entry for it
in `tools/slice-character.js` with a `names` list in the order above, plus a
facing entry per frame in `tools/frame-facing.js`.
