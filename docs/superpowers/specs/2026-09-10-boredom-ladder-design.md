# Raj's boredom ladder — design

Status: stage 1 built and running. Stages 2+ still just specced.
Date: 2026-09-10.

This is the *design record* — the reasoning, the alternatives rejected, and what
was verified. For how the feature behaves as it stands now, see
[BEHAVIOUR.md](../../BEHAVIOUR.md); for the poses it uses per character, see
[CHARACTERS.md](../../CHARACTERS.md).

## What this is

One connected behaviour: what the pal does when you stop interacting with it.
The longer you ignore him, the further down the ladder he goes, ending in the
Dock trip and then a nap.

This spec merges three separately-requested features, because they all trigger
off the same signal and would otherwise fight each other for control:

| Requested as | Becomes |
|---|---|
| "Escalating boredom" | rungs 1–2 of the ladder |
| "Dock scrolling 2–3 times, then back to his chair" | rung 3 |
| "Naps through your meetings" | rung 4 |

Built separately, all three would wake up at the same moment and each try to
set `animation` and `state`. Merging them makes the escalation the feature
rather than a bug to be arbitrated.

## The ladder

Driven by how long since **any** keyboard or mouse input, system-wide.

| Rung | After | He does |
|---|---|---|
| 0 | — | Normal: existing random wander + flourishes. Unchanged. |
| 1 | 30s | Fidgets. No new poses — just shortens the existing idle timer so flourishes come more often than the usual 8–20s. |
| 2 | 2 min | Walks to his chair and sits down. Gives up on you. |
| 3 | 5 min | The Dock trip (below). Returns to his chair and sits. |
| 4 | 15 min | Dozes off where he sits. |
| — | you touch anything | Startles awake, then back to rung 0. |

Timings live in one table and are tunable. They are deliberately long: this
behaviour is meant to be discovered, not performed at you.

## The Dock trip

1. Walk to the Dock's edge.
2. If the Dock is hidden, ask for help (see below). If it's visible, skip to 3.
3. Traverse its length **2–3 times** (random), slowly.
4. Walk back to his chair and sit.

### Finding the Dock

`screen.getPrimaryDisplay().workArea` does **not** reveal the Dock when
auto-hide is on — measured on the target machine, the only inset was the 39px
menu bar. So read the Dock's own preferences instead:

```
defaults read com.apple.dock orientation   -> left | right | bottom
defaults read com.apple.dock autohide      -> 0 | 1
defaults read com.apple.dock tilesize      -> icon size
```

No permission prompt, no Accessibility, works whether or not the Dock is
hidden. This is a subprocess, so read it once at startup, cache it, and refresh
on `display-metrics-changed` and on a slow timer. Never in the tick loop.

Non-macOS: the whole Dock trip is skipped, and rung 3 falls through to rung 4.
The taskbar equivalent is out of scope.

### Constraint: the window does not cover a pinned Dock

`chotuWindowBounds()` sets the pal's window to `workArea`, not
`display.bounds`. When the Dock is **pinned**, macOS removes the Dock strip
from `workArea` — so the window does not extend over the Dock at all, and no
amount of changing `_clamp()` will let the pal stand on it.

This is counterintuitive and worth stating plainly: **pinning the Dock makes
this harder, not easier.** Hidden Dock → `workArea` is the full screen and the
pal can reach the edge. Pinned Dock → the pal is locked out of the strip.

Two ways out:

- **(A) Walk alongside it.** Patrol the edge of the work area, immediately
  beside the Dock, rather than on top of it. No window changes, no coordinate
  changes, and it survives pinning and unpinning for free because
  `display-metrics-changed` already resizes everything (main.js:1021).
- **(B) Enlarge the window to `display.bounds`.** Lets him walk over the Dock
  properly. Touches window bounds, roam bounds, the house position, and the
  screen↔local coordinate translation at main.js:792. Also unverified whether
  the pal renders above the Dock at all.

**Stage 1 uses (A).** Visually it is nearly identical — he is standing next to
your Dock looking along it — for a small fraction of the work. (B) is a later
upgrade if walking *on* the Dock turns out to matter.

### Asking for the cursor

The pal cannot make a hidden Dock appear. Only the real mouse can. So rather
than inspecting an empty strip, he asks:

1. Arrives at the edge, plays the `point` pose, bubble: *"psst, bring your
   mouse over here?"*
2. Waits up to 20s for the cursor to come within 40px of that edge.
3. Cursor arrives → assume the Dock has slid out, start the passes.
4. Nobody comes → clear the bubble, shrug, walk back, sit. Slightly wounded.

**Known limitation, accepted:** we cannot observe whether the Dock is actually
on screen. "Visible" is inferred from cursor proximity to the Dock edge. In
practice these coincide, and when the Dock is pinned the question never arises.

This requires the cursor position every tick. Today `pollCursor()` only runs
when the follow-cursor setting is on (main.js:786). Sample the point
unconditionally — it is one cheap syscall — and keep the `pal.updateCursor()`
call gated on the setting, so follow-cursor behaviour is untouched.

### Which pose while patrolling

The art has no up/down poses — stated in `state.js:35` and confirmed by Raj's
31 frame names. A vertical patrol using the walk cycle would be the moonwalk
bug again on the other axis.

- **Bottom Dock** → horizontal travel, use `walk`. Looks correct, no new art.
- **Left/right Dock** → vertical travel, use a *stationary* looking pose and
  move slowly. Pausing and the head-turn sell "inspecting"; the leg animation
  is what would break it.

## Per-character art, and Raj cannot lie down

Every pose must be checked against the character, not assumed. `CHARACTERS` in
main.js already carries a `moods` fallback table for exactly this reason.

Raj's flourishes are `phone, crossed, splash, thumbsup, glasses, dance, jump,
sit`. He has **no `lie` art** — only the dog does. So "dozes off" cannot be a
lie-down for Raj.

Resolve each new pose through a preference list, first available wins:

| Need | Preference | Raj gets | Dog gets |
|---|---|---|---|
| doze | `lie` → `sit` → `idle` | `sit` | `lie` |
| inspect | `glasses` → `crossed` → `idle` | `glasses` | `sit`¹ |
| ask | `point` → `wave` → `idle` | `point` | `wave` |
| startle | `jump` → `wave` → `idle` | `jump` | `wave` |

¹ via the existing `moods` mapping.

Add a `zzz` bubble on the doze rung so it reads as sleeping rather than sitting.

## Fitting into what already exists

This is the risky part. The ladder must lose every argument it picks.

- **Reminders outrank everything.** `requestReminder()` (state.js:326) only
  interrupts a fixed list of states. The new states **must** be added to that
  list, or a stretch/water reminder silently vanishes during a Dock trip —
  breaking the app's actual purpose. This is the single most important detail
  in this spec.
- **Focus sessions suppress the ladder entirely.** If `_focusActive`, no rungs
  fire. Sitting still is the point of a focus session.
- **Follow-cursor mode** needs no special case: moving the mouse resets the
  idle clock, so the ladder cannot engage while you're actively steering him.
- **Dragging** likewise — it's mouse input, so the clock resets and he drops to
  rung 0 when put down.
- **Asleep in the house** (`SLEEPING`, `GOING_HOME`, `ENTERING_HOUSE`): ladder
  off. That is a different, deliberate sleep.
- **Display changes mid-patrol**: `setBounds()` is already called on
  `display-metrics-changed`. The patrol span must be recomputed from the new
  bounds, or abandoned back to the chair. It must not keep walking to a
  coordinate that no longer exists.

## Implementation shape

Reuse the existing idiom rather than inventing one. The codebase already does
"walk somewhere, then do a thing on arrival" via a pending flag plus `WALKING`
(`_pendingWork`, `_pendingReminder`). Follow that:

- New states: `ASKING_CURSOR`, `PATROLLING`, `DOZING`.
- Travel to the Dock and back reuses `WALKING` with a pending flag.
- The patrol loop itself mirrors `PLAYING` (state.js:497) almost exactly:
  waypoint, arrive, decrement a counter, next waypoint, then finish.
- Idle time from `powerMonitor.getSystemIdleTime()` — built into Electron,
  currently unused, no permission required. Sampled in the existing tick loop,
  not with a new timer.
- Dock facts in a small module with one job: report `{ edge, hidden, tileSize }`
  or `null` when unavailable.

Rungs are data, not branches: one ordered table of `{ afterMs, enter() }` so
adding or reordering a rung does not mean touching the state machine.

## Settings

- `boredomLadder` (default true) — the whole feature.
- `dockTrip` (default true) — rung 3 only, since it's the one that moves him a
  long way and is macOS-only.

Both in `store.defaults`. A settings-window toggle is not part of stage 1.

## Out of scope for stage 1

Chosen, specced later, deliberately not built now:

- **Cursor games** — flinch from a fast cursor, creep after a slow one. Small,
  builds on follow-cursor.
- **Copy-paste courier** — needs clipboard polling and a new prop to carry.
- **Peeking over windows** — needs Screen Recording or Accessibility
  permission and goes stale whenever a window moves. Most charming, most
  fragile, deliberately last.

Also noted: a frontmost-app watcher with a `MOOD_BY_APP` table **already
exists** (main.js:697, off by default via the `focusMoods` setting). The
"reacts to the app you're in" idea is largely built already.

## Stage 1 as built

Built as specced above, with four additions that only became obvious once it was
running.

### 1. He stands clear of a hidden Dock, not on its edge

The design said "walk alongside the Dock". With the Dock **pinned** that comes
for free — the work area already excludes the Dock strip. With the Dock
**auto-hidden** it does not: the work area is the full screen, so the patrol
line sat exactly where the Dock slides out to, and the Dock would have revealed
itself on top of him.

So when `autohide` is on, the patrol line is inset from the edge by roughly the
Dock's own thickness (`tileSize + 24px`). Measured on the target machine
(`tilesize 41`, Dock on the left): the line moves from `x = 0` to `x = 65`, which
puts him beside a revealed Dock rather than behind it.

### 2. A "Play" submenu — every rung, on demand

The whole ladder only happens when nobody is touching the machine, which makes
it impossible to show anyone deliberately and impossible to check after changing
it. So every rung is also a menu item, on both the tray menu and the pal's
right-click menu:

```
Play ▸  Fidget (30 sec)
        Give up on me (2 min)
        Go look at the Dock (5 min)
        Doze off (15 min)
```

The submenu is generated from `BOREDOM_RUNGS`, so a rung added or retimed shows
up here with no menu code touched, and the labels carry the real wait — the menu
doubles as documentation of a feature you would otherwise never see the shape
of. (With `MINIME_BOREDOM_SCALE` set, the labels show the scaled waits, which is
the honest answer to "how long until this fires".)

Picking a rung does exactly what reaching it by escalation does. That is the
whole requirement, and it has two consequences worth stating:

- **It has to get itself there first.** The ladder always arrives at a rung
  having already walked him to his chair on rung 2. A rung played out of order
  hasn't, so `sulk` and `doze` walk to the chair first and then start (`asked`
  in `_enterRung`, `_pendingSulk` / `_pendingDoze`). Asking him to doze while
  he's across the screen makes him go to bed, not sleep standing up.
- **Afterwards it is not special.** Input startles him out of it, and continued
  quiet escalates him onward to the next rung, from the rung you picked.

Items are **greyed out, not hidden**, when unavailable — no Dock to visit, on
Windows, with `dockTrip` off, during a focus session, while being dragged, or
while going to bed (`canPlayRung`). A menu that changes shape is harder to learn
than one where an item is visibly not available right now.

#### The idle-clock exemption, and why it is required

A rung asked for is not boredom, so it needs a window where the idle clock can't
cancel it (`_manual`, `MANUAL_GRACE_MS`, `_manualHolding()`). This is not a
convenience:

- The mouse movement that opened the menu *is* input. Without the exemption,
  every item would cancel itself the moment it was clicked.
- The Dock trip is exempt for its **whole** length, not just the grace: it asks
  you to bring the mouse over, so it cannot treat a moved mouse as an
  interruption. It also ends in ordinary wandering rather than a sulk — he ran
  an errand, he wasn't ignored.
- The grace does not start counting until he has **arrived**. Walking to the
  chair takes longer than any sensible grace period, so a countdown that starts
  at the click cancels him mid-journey and the menu item appears to do nothing.
  Found by the harness, not by reading the code.

And the exemption must never be able to strand him: with `boredomLadder` off,
escalation is skipped but the input reset still runs, so a rung played by hand
is always something a keypress can end. Also found by the harness.

### 3. Two environment variables for testing

| Variable | Effect |
|---|---|
| `MINIME_BOREDOM_SCALE=0.1` | Multiplies every rung time. `0.1` puts the doze rung 90s out instead of 15 minutes. Ignored unless it parses to a positive number, so a typo cannot switch the feature off. |
| `MINIME_DEBUG_LADDER=1` | Logs every state change with the idle clock, rung, position and Dock beside it. Silent otherwise. |

The ladder is the one behaviour that by definition only happens when nobody is
interacting with the app, so without these the only way to check it is to sit
perfectly still and hope.

### 4. The display bounds are cached

`cursorNearDock()` runs every tick and needs the **full** display, including the
strip the work area excludes. Calling `screen.getDisplayNearestPoint()` 60×/s
for that would be wasteful, so `computeWorkArea()` now caches
`display.bounds` alongside the work area. Both are refreshed by the existing
`display-metrics-changed` handler.

### Files changed

```
 dock.js                 NEW  — reads orientation/autohide/tilesize, cached
 state.js                     — 4 states, the rung table, the patrol, the trip
 renderer/animations.js       — DERIVED_POSES, so the 4 new poses resolve per character
 main.js                      — idle sampling, cursor sampling, chair, Dock refresh, Play submenu
 test/ladder-sim.js      NEW  — 30 assertions, headless
 test/play-sim.js        NEW  — 29 assertions, headless
 test/probe-*.js         NEW  — the two Electron probes, kept for re-checking
 package.json                 — `npm test`; dock.js added to the packaged files
```

**One packaging bug came out of this.** `build.files` is an allowlist, and a new
top-level module is not covered by any of its patterns — so `dock.js` would have
been missing from a built app and `require('./dock')` would have failed at launch.
Caught by reading the manifest, not by running anything: `npm start` runs from the
source tree, where the file is obviously present. This is the same trap that
shipped a build with no tray icon once before (`BUILD_LOG.md` §5.1). **Any new
top-level `.js` file has to be added to `build.files` by hand.**

Nothing was removed and no existing behaviour was rewired: the ladder is
additive, and every existing state falls through it untouched.

## How to tell it works

The ladder's timings make manual testing tedious, so make them overridable and
verify the seams rather than waiting 15 minutes:

1. **Rungs fire in order** with compressed timings; no rung skipped or repeated.
2. **A reminder during a Dock trip still arrives.** The regression that matters
   most.
3. **Starting a focus session** mid-ladder cancels it and he sits at the work
   spot.
4. **Touching the keyboard** at each rung returns him to normal, including
   mid-patrol.
5. **Dock on each edge** — left, right, bottom — produces a sane patrol span,
   and the pose is `walk` only for bottom.
6. **Pinning and unpinning the Dock** while he patrols does not leave him
   walking off-screen or stuck.
7. **A non-macOS run** skips rung 3 without error.

### What was actually verified

**Headless, 59 assertions across two harnesses, all passing.** `PalState` was
driven with a fake system-idle clock — no Electron, no waiting.

The ladder harness (30) covers all seven checks above plus: the hidden-Dock ask
and its 20s give-up, both feature switches, switching the ladder off mid-patrol,
sending him to bed while dozing, picking him up mid-patrol, and losing the Dock
entirely mid-patrol. Check 2 is asserted in two places: interrupting the walk
*to* the Dock, and interrupting the patrol itself.

The Play harness (29) drives every rung from the menu **with the mouse held
active the whole time**, which is what actually happens when someone clicks a
menu item to watch it — and is the case that broke twice. It covers: each rung
doing its thing, sulk and doze walking to the chair first, doze already in the
chair starting on the spot, the grace window, input after the grace, escalating
onward from a played rung, clicking him as the way out (including mid-ask), a
reminder still winning, and every reason a rung is unavailable.

Both harnesses live outside the repo. Their failures divided into two kinds,
worth separating because only one kind was a bug:

- **The harness's own timings, twice.** 45 seconds is long enough for the entire
  patrol to finish, so it sampled him back in his chair and called it a bug. Any
  test of this feature needs to wait for a state, not sleep for a duration.
- **Two real defects, both in the on-demand path, neither reachable by hand.**
  The grace expiring mid-walk, and a played rung being inescapable with the
  ladder switched off. Both are described above.

**Pose resolution, per character.** Confirmed against the real sheets rather
than assumed:

| | doze | inspect | ask | startle |
|---|---|---|---|---|
| raj | `sit_01` | `glasses_01` | `point_01` | `jump_01` |
| hanu | `hanu_sleep_01` | `hanu_wave_01` | `hanu_wave_01` | `hanu_jump_01` |
| boy / girl | `*_sleep_01` | `*_wave_01` | `*_wave_01` | `*_jump_01` |
| dog | `dog_sleep_01` | `dog_sit_01` | `dog_wave_01` | `dog_run_02` |

Raj dozing in a `sit` is the predicted outcome, not a fallback failure — he has
no lying-down art. This is why the doze rung also shows a `zzz` bubble.

**In Electron, on the target machine.** Two things the headless harness cannot
answer:

- `powerMonitor.getSystemIdleTime()` returns a rising second count in an
  accessory app with **no permission prompt of any kind**.
- `dock.read()` reported `{ edge: 'left', hidden: true, tileSize: 41 }`, matching
  `defaults read com.apple.dock` exactly. Note the design assumed this machine's
  Dock was on the right; it is on the left. Detection is why that did not matter.

**Live, in the running app**, with the ladder compressed 10× — the trace, edited
only for width:

```
FOLLOWING -> RESTING   rung=1 anim=sit  idle=3s   dock=left/hidden
RESTING   -> WALKING   rung=2 anim=walk idle=12s  dock=left/hidden
WALKING   -> SULKING   rung=2 anim=sit  idle=25s  pos=(41,228)
SULKING   -> WALKING   rung=3 anim=walk idle=30s
WALKING   -> ASKING_CURSOR rung=3 anim=ask idle=30s pos=(65,277)
ASKING_CURSOR -> IDLE  rung=0 anim=startle idle=0s
```

Every rung in order, the ask at the offset patrol position, and the startle the
moment input returned.

### Two things that will look like bugs and are not

Both were hit in practice within minutes of it going live.

- **Follow-cursor on.** He chases the mouse, which looks like constant activity,
  and the mouse movement that makes him chase is the same movement that resets
  the ladder. He will essentially never get bored while you are steering him.
- **A focus session running.** The ladder is suppressed entirely, by design.
  Nothing on the ladder will fire until the session ends, however long you sit
  still.

Neither prints anything without `MINIME_DEBUG_LADDER=1`, which is why they are
worth writing down.
