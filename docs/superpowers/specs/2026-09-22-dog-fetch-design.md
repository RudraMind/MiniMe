# Dog fetch — design

Status: built, tested and committed. `test/fetch-sim.js` passes all 34 checks.
Date: 2026-09-22.

The design record: what it does, the reasoning, what was rejected and why, and
which parts are already proven against the real art. For how existing behaviour
works, see [BEHAVIOUR.md](../../BEHAVIOUR.md); for what art each character has,
see [CHARACTERS.md](../../CHARACTERS.md).

Companion: [ART-PROMPT-dog-fetch.md](../../ART-PROMPT-dog-fetch.md), the prompt used
to generate the new poses.

## What this is

Fetch, for the dog character only. The bone becomes a real object you can pick up
and throw anywhere on the screen. The dog runs to it, picks it up, brings it back
to your cursor, drops it at your feet and then sits and stares at you until you
throw it again.

## The loop

| Beat | What the dog does | Art |
|---|---|---|
| Throw | You drag the bone and drop it somewhere | — |
| Run | Sprints to the bone, fast, using the run cycle | `dog_run_01/02/03` (existing) |
| Pick up | One short beat, head down at the bone | `dog_pickup_01` (new) |
| Carry | Trots back to your cursor, slower than the run out | `dog_carry_01/02` (new) |
| Tease | One time in five: stops short of you, holds, then closes in | `dog_hold_01` (new) |
| Drop | Bone is left at the cursor position | — |
| Stare | Sits and watches you, waiting to be thrown it again | `dog_hold_01`, `dog_eager_01` (new) |

Sprint out, trot back. Dogs do exactly this, and it costs nothing — the run cycle
already exists and the carry frames are a walk.

## The one change from the original request

The request was that the dog drop the bone **near the house** and then come to you.
This design has it drop the bone **at your cursor** instead, and the house is only
where the bone parks on first run.

Two trips (bone to house, then house to you) makes the dog look like a courier, and
it puts the payoff — the staring — a long walk away from where you are looking. One
trip is both more doglike and tighter to play with. Agreed in discussion before this
was written.

## States

New states in `state.js`, following how `PLAYING` is already structured:

| State | Ends when | Then |
|---|---|---|
| `FETCH_RUN` | Reaches the bone | `FETCH_PICKUP` |
| `FETCH_PICKUP` | ~350 ms beat elapses | `FETCH_CARRY` |
| `FETCH_CARRY` | Reaches the cursor, or stops short if teasing | `FETCH_HOLD` |
| `FETCH_HOLD` | You throw again, or the wait times out | `IDLE` |

`FETCH_RUN` uses the existing `run` animation at full speed; `FETCH_CARRY` uses the
carry frames at walk speed. Facing comes free from `_moveToward`, which already sets
it from travel direction.

## The bone as a real object

Today the bone is drawn from `playAnchor` and exists only during `PLAYING`
(`renderer/chotu.js:245`). It becomes a persistent object:

- `bonePos` in the store, exactly like `housePos` already is. Parked next to the
  house door on first run, so it starts somewhere sensible.
- Draggable: `dragTarget` in `renderer/chotu.js` gains `'bone'` beside `'pal'` and
  `'house'`, and `main.js` gains a `bone:drag` / `bone:dragend` pair mirroring
  `house:drag` at `main.js:1012`.
- The hit box is padded by about 8 px. The bone is 24 px on screen and the window is
  click-through except over the pal and the house; without padding it is slippery to
  grab.

**The prop element is hidden while the bone is carried.** The carry and hold frames
have the bone drawn into them, so there is no runtime offset to maintain and no
chance of the prop drifting away from the mouth. This replaces an earlier plan to
track the muzzle per frame, which would have needed hand-tuned numbers for every
carry frame and still looked approximate.

## Art, and what is already proven

Source: one generated sheet (see the art prompt doc). Of the eight poses requested,
two arrived as asked; the rest were substituted by the model. The gaps are closed by
compositing the bone, which has been done and measured rather than assumed.

| New frame | Built from | Facing |
|---|---|---|
| `dog_carry_01` | Generated figure 1 — already carries the bone | right |
| `dog_carry_02` | Generated figure 7 + bone composited at (245, 130) | right |
| `dog_pickup_01` | Generated figure 8 + bone composited at (37, 248) | left |
| `dog_hold_01` | Generated figure 6 — sits facing the viewer, bone in mouth | front |
| `dog_eager_01` | Generated figure 5 — play bow | right |

`dog_pickup_01` faces left while the dog's target facing is right. That is not a
problem and needs no redrawing: `tools/frame-facing.js` records facing per frame and
the slicer mirrors what disagrees with the target.

Two things established by measurement:

1. **The bone had to change colour.** The shipped cream bone composited onto the
   dog's muzzle lands 114 pixels exactly where intended and is invisible, because the
   dog is cream too. The new bone is biscuit brown with a dark outline and reads
   instantly. Contrast had to come from the art, not from code.
2. **The offsets above are exact, not eyeballed.** Blending on raw buffers changes
   1,899–1,907 pixels inside a box exactly 63×59 — the prop and nothing else.
   `sharp`'s own `composite()` was disturbing roughly 14,000 pixels and reporting a
   bounding box covering most of the figure, so it is not used for this.

Assembly: the five new frames go onto a white sheet at `assets/reference/`, with a
spec entry in `tools/slice-character.js` and a facing entry each in
`tools/frame-facing.js`, so a re-cut reproduces them. The soft drop shadows the
generator added are grey rather than white, so white keying leaves them; the
slicer's ground pass should clear them, and that will be checked after slicing
rather than assumed.

## What beats fetch

Fetch yields to everything that already outranks play, copying how `PLAYING` gives
way: a stretch or water reminder, being dragged, sleep and waking, a focus session
and its break, and the boredom ladder. Fetch is a game, not an obligation.

## Gate

Only when the active character is the dog. For the other four the bone is hidden and
nothing changes, exactly as today.

## Testing

New `test/fetch-sim.js`, in the style of `test/ladder-sim.js`: drives `PalState`
headlessly with a fake clock, no Electron. Cases:

- Bone dropped away from the dog starts `FETCH_RUN`.
- Reaching the bone runs the pickup beat, then carries.
- Arriving at the cursor drops the bone there and enters `FETCH_HOLD`.
- The tease fires, and fires at roughly the intended rate over many runs.
- Each interrupt above wins from each fetch state.
- The dog never leaves bounds during any of it.
- A non-dog character never enters a fetch state, even with a bone on the floor.

Wired into `npm test`.

## Files touched

`state.js`, `main.js`, `renderer/chotu.js`, `package.json`,
`tools/slice-character.js`, `tools/frame-facing.js`, new
`assets/reference/dogfetchsheet.png`, five new frames in `assets/dog/`, a new
biscuit bone in `assets/props/`, new `test/fetch-sim.js`, and updates to
`BEHAVIOUR.md` and `CHARACTERS.md`.

## Rejected

| Idea | Why not |
|---|---|
| Drop the bone at the house, then walk to you | Two trips, and it puts the staring beat away from where you are looking. Reads as a courier, not a dog. |
| Fetch only while follow-cursor is on | Hides the feature behind a setting you would forget you turned off. |
| Track the muzzle per frame and overlay the bone while carrying | Needs hand-tuned numbers per frame and still looks approximate. Drawing the bone into the carry frames removes the problem. |
| Reuse `dog_drink_01` as the head-down pick-up pose | Its water bowl is painted into the frame. Same for `dog_sleep_01` and its pillow. |

## Decisions still open

1. How long the dog stares before giving up and going back to idle. Proposal: 6
   seconds.
2. How often the tease fires. Proposal: one time in five.
3. Whether the other four characters should ever fetch. Proposal: no, not now —
   none of them has carry art, and the dog is the one it suits.
