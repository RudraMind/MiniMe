# Behaviour, states and the chair — reference

How the pal decides what to do. Covers the state machine, the chair, the boredom
ladder, focus sessions, reminders, follow-cursor, and every constant worth
knowing before changing any of it.

Companion docs:
[CHARACTERS.md](CHARACTERS.md) — art and poses ·
[the ladder design spec](superpowers/specs/2026-09-10-boredom-ladder-design.md) —
why the ladder is built the way it is.

---

## Shape of the app

```
main.js       Electron main process. Windows, tray, menus, settings store,
              screen geometry, the 16ms tick, cursor + system-idle sampling.
              Owns everything platform-specific. Never loads art.
state.js      PalState — the whole state machine. Pure logic: no Electron,
              no DOM, no filesystem. Given a tick and some numbers, it decides
              a state, a position, a semantic pose and a bubble.
dock.js       macOS Dock facts: { edge, hidden, tileSize } or null.
timers.js     Pausable stretch/water reminder timers.
preload.js    The only IPC surface, channel-allowlisted.
renderer/     Drawing only. animations.js maps semantic poses to frames;
              chotu.js draws; recolor.js recolours; overlay/settings windows.
```

`state.js` having no Electron dependency is the single most useful property of
this codebase: **the entire behaviour is testable headlessly** by constructing a
`PalState`, feeding it fake numbers and calling `tick(16)` in a loop. Every
behaviour claim in these docs was checked that way. Do the same before changing
anything here.

The tick is `TICK_MS = 16` (~60fps), driven from `main.js`. `state.js` scales all
movement by `dtMs / REFERENCE_TICK_MS` — `walkSpeed` is *pixels per 16ms*, not
pixels per ms. Scaling by raw `dtMs` once made the pal cover ~1400px/sec.

---

## States

`STATES` in `state.js`. All 19:

| State | Meaning |
|---|---|
| `IDLE` | Standing about. Runs the wander/flourish loop. |
| `WALKING` | Travelling to a point. **What happens on arrival is decided by a pending flag** — see below. |
| `REMINDING` | Doing a stretch or water nudge. The app's actual job. |
| `GOING_HOME` | Running to the house door. |
| `ENTERING_HOUSE` | At the door, going in. |
| `SLEEPING` | Inside the house. **The sprite is hidden entirely.** |
| `WAKING` | Coming back out. |
| `EXITING_HOUSE` | Out of the door, resuming. |
| `FOLLOWING` | Chasing the cursor (follow-cursor mode). |
| `RESTING` | Cursor stopped nearby, sitting with it. |
| `DRAGGED` | Being carried by the mouse. |
| `WORKING` | Sitting at the **chair** during a focus session. |
| `BREAK` | Stretching between focus sessions. |
| `PLAYING` | Bouncing around a dropped bone. Dog only. |
| `SULKING` | Boredom rung 2 — sat in his chair, given up on you. |
| `ASKING_CURSOR` | Boredom rung 3 — at a hidden Dock, asking for your mouse. |
| `PATROLLING` | Boredom rung 3 — pacing the length of the Dock. |
| `DOZING` | Boredom rung 4 — asleep where he sat. |

### The "walk somewhere, then do a thing" idiom

There is no separate state per journey. `WALKING` plus a pending flag, checked in
a fixed order on arrival:

```
_pendingWork  → sit down and work (focus session)
_pendingReminder → do the stretch/water nudge
_pendingDock  → arrived at the Dock: ask for the cursor, or start patrolling
_pendingDoze  → arrived at the chair: doze off
_pendingSulk  → arrived at the chair: sit down and sulk
(none)        → _arriveIdle()
```

**This order is load-bearing.** It is the precedence rule for "two things wanted
him to walk somewhere". Follow this idiom for any new journey rather than adding
a state.

---

## The chair (`workSpot`)

One remembered spot, used by two features. There is no chair sprite — it's a
coordinate.

- **Stored** as `workSpot` in settings; `null` means "not chosen yet".
- **`null` resolves to the centre of the roam area** (`defaultWorkSpot()`).
- **Always clamped to the current roam bounds on read** (`workSpot()` in
  `main.js`), so a spot saved on a 4K monitor is still valid on a laptop screen.
- **`state.js` holds its own copy** as `_chair`, set via `pal.setChair(spot)`.
  `null` there means "sit where you stand".

Who uses it:

| Feature | Use |
|---|---|
| Focus session | He walks there and sits for the whole session (`WORKING`) |
| Boredom rung 2 (sulk) | He walks there and sits down |
| Boredom rung 4 (doze) | He dozes there |

**How it moves:** drag him during a focus session and drop him. `state.js` emits
`workSpotMoved` with the drop position, `main.js` writes it to settings and calls
`setChair()` again. That is the only way to set it — there's no picker UI.

`setChair()` must be re-called whenever the geometry changes, or he'd walk to a
coordinate that no longer exists. Three places do it: startup, `workSpotMoved`,
and `display-metrics-changed`.

**Deliberate design decision:** the boredom ladder reuses the focus-session chair
rather than inventing a second remembered spot. One place he considers "his", not
two.

---

## The boredom ladder

Driven by time since **any** system-wide keyboard or mouse input —
`powerMonitor.getSystemIdleTime()`, sampled in the existing tick loop (throttled,
every `IDLE_SAMPLE_TICKS = 16` ticks) and handed to `state.js` via
`setSystemIdleMs()`. No permission prompt, no polling timer of its own.

| Rung | After | He does |
|---|---|---|
| 0 | — | Normal wander and flourishes |
| 1 `fidget` | 30 sec | Flourishes come every 2.5–6s instead of 8–20s. **No new poses** — that's the whole rung |
| 2 `sulk` | 2 min | Walks to the chair and sits. Gives up on you |
| 3 `dock` | 5 min | The Dock trip, then back to the chair |
| 4 `doze` | 15 min | Dozes where he sits, with a `zzz` bubble |
| — | you touch anything | `startle` pose for 700ms, then rung 0 |

The rungs are a **data table** (`BOREDOM_RUNGS`), not branches — add or retime a
rung without touching the state machine or the menu. Escalation advances **one
rung at a time**, and a rung that declines (no Dock on Windows, say) is still
marked done so the ladder falls through to the next instead of retrying every
tick.

### The Dock trip (rung 3, macOS only)

1. Walk to the Dock's edge.
2. Dock hidden? Ask for the cursor. Visible? Straight to step 3.
3. Pace its middle stretch **2–3 times**, slowly.
4. Walk back to the chair and sit.

`dock.js` reads `defaults read com.apple.dock` (`orientation`, `autohide`,
`tilesize`). This is the **only** reliable source: `workArea` reveals nothing when
the Dock auto-hides. Cached, refreshed every 60s and on display changes — never
in the tick loop, it's a subprocess. Off macOS it returns `null` and the rung
declines.

**The counterintuitive geometry.** Pinning the Dock makes this *harder*, not
easier: macOS removes a pinned Dock's strip from `workArea`, and the pal's window
is sized to `workArea`, so he's locked out of it. A hidden Dock leaves `workArea`
as the full screen — so the patrol line sat exactly where the Dock slides out to,
and the Dock would appear on top of him. Hence `DOCK_PAD_PX`: when `autohide` is
on, the line is inset by `tileSize + 24px`. On this machine that moves it from
x=0 to x=65.

**Asking for the cursor.** The pal cannot make a hidden Dock appear; only the real
mouse can. So he plays `ask`, bubbles *"psst, bring your mouse over here?"*, and
waits up to 20s for the cursor within 40px of that edge. Arrives → assume the Dock
slid out, start pacing. Nobody comes → clear the bubble, walk back, sit.

Accepted limitation: we cannot observe whether the Dock is really on screen.
"Visible" is inferred from cursor proximity.

**Pose.** Left/right Dock → vertical travel → stationary `inspect` pose, moving
slowly. Bottom Dock → horizontal → `walk`. There is no up/down art; using the
walk cycle vertically is the moonwalk bug on the other axis.

### The Play menu — every rung on demand

The ladder only fires when nobody is touching the machine, which makes it
impossible to demonstrate or check. So every rung is also a menu item, on the
right-click menu **and** the tray menu:

```
Play ▸  Fidget (30 sec)
        Give up on me (2 min)
        Go look at the Dock (5 min)
        Doze off (15 min)
```

Generated from `BOREDOM_RUNGS`, so retiming a rung updates the labels. API:
`pal.canPlayRung(key)` → boolean, `pal.playRung(key)` → boolean.

Picking a rung does **exactly** what reaching it by escalation does. Two
consequences:

- **It gets itself there first.** Escalation always arrives at a rung having
  already walked him to the chair on rung 2. A rung played out of order hasn't, so
  `sulk` and `doze` walk to the chair first (`_pendingSulk` / `_pendingDoze`).
- **Afterwards it isn't special.** Input startles him out; continued quiet
  escalates onward from the rung you picked.

Items are **greyed out, not hidden**, when unavailable: no Dock, `dockTrip` off,
focus session running, being dragged, going to bed.

### The idle-clock exemption — read before touching `_manual`

A rung asked for is not boredom, so it needs a window where the idle clock can't
cancel it (`_manual`, `MANUAL_GRACE_MS`, `_manualHolding()`). Three rules, each
of which exists because its absence was a real bug:

1. **The mouse movement that opened the menu is itself input.** Without the
   exemption every item cancels itself the instant it's clicked.
2. **The grace does not start until he has arrived.** Walking to the chair takes
   longer than any sensible grace, so a countdown starting at the click cancels
   him mid-journey and the menu item appears to do nothing. `_manualHolding()`
   returns true while any of `_pendingSulk` / `_pendingDoze` / `_pendingDock` is
   set.
3. **The Dock trip is exempt for its whole length**, not just the grace — it asks
   you to move the mouse over, so it cannot treat a moved mouse as an
   interruption. It also ends in ordinary wandering rather than a sulk: he ran an
   errand, he wasn't ignored.

And the exemption must never strand him: with `boredomLadder` off, escalation is
skipped but **the input reset still runs**, so a played rung is always something a
keypress can end.

---

## Precedence — the ladder loses every argument

The ladder is additive, and everything else outranks it. In `_ladderTick`, in
order:

1. `_manualHolding()` — a requested rung, still in its window.
2. `_focusActive` or `_dragging` → nothing.
3. These states → nothing: `REMINDING`, `WORKING`, `BREAK`, `DRAGGED`,
   `GOING_HOME`, `ENTERING_HOUSE`, `SLEEPING`, `WAKING`, `EXITING_HOUSE`.
4. Idle under `BOREDOM_RESET_MS` (2s) → reset, with a startle if he'd got anywhere.
5. `boredomLadder` off → stop here.
6. Otherwise escalate.

**The single most important detail in the whole feature:** the four boredom
states are in `requestReminder()`'s interruptible list. A stretch or water nudge
silently vanishing because the pal happened to be inspecting the Dock is a far
worse bug than any amount of missed idle charm. If you add a state, ask whether it
belongs in that list — and assert it.

Everything that resets the ladder: `requestReminder`, `startWork`, `beginDrag`,
`requestSleep`, `wave` (clicking him), returning input, and
`setBoredomEnabled(false)`.

---

## Reminders

`timers.js` — two `PausableTimer`s (stretch, water) with intervals from settings.
Pausable so time spent asleep doesn't fire a backlog. `pal.requestReminder(kind)`:

- Being dragged → **queued**, not dropped (`_queuedReminder`), fired on release.
- State not interruptible → refused (returns `false`).
- A different reminder already pending → queued.
- Otherwise: reset the ladder, set `_pendingReminder`, walk to the **centre of
  the roam area** (not the chair) and do it there.

Known open issues around reminders being dropped in some states are catalogued in
`../MACOS-PORT.md` Part 5, Issues 1–5. **Those are report-only; do not fix them
without asking.**

---

## Focus sessions

`focusSessionMin` (default 25) work, `focusBreakMin` (default 5) break. Work
phase: walk to the chair, sit (`WORKING`). Break: `BREAK` with a bubble from
`BREAK_BUBBLES`. Dropping him mid-session sits him down and moves the chair to
where you dropped him instead of wandering off.

While `_focusActive`, the whole boredom ladder is suppressed — sitting still is
the point of a focus session. **This looks exactly like the ladder being broken**;
see the gotchas at the end.

---

## Follow-cursor, dragging, play, house

**Follow-cursor** (`followCursor`, default off). `FOLLOWING` when the cursor is
more than `FOLLOW_DEADZONE_PX` (12px) away, at `FOLLOW_SPEED_FACTOR` (0.7) of
walk speed; `RESTING` once the cursor has been still for `CURSOR_IDLE_MS` (3s).
Only `IDLE`, `FOLLOWING` and `RESTING` can follow.

The cursor point is sampled **every tick regardless of the setting** — it's one
cheap syscall, and the Dock trip needs it to know when your mouse arrives. Only
`pal.updateCursor()` is gated on the setting, so follow-cursor behaviour is
unchanged.

**Dragging.** `DRAGGED` while held; on release he holds the spot for
`DRAG_HOLD_MS` (8s) before resuming, then drains any queued reminder.

**Play** (dog only). `PLAYING`, 3–6 hops within `PLAY_RADIUS_PX` (70) of where the
bone was dropped, at 1.25× speed.

**House.** `requestSleep()` → `GOING_HOME` → `ENTERING_HOUSE` → `SLEEPING`, which
**hides the sprite**; the house shows `night` art and a `zzz`. Its position is
`housePos` (`null` = default top-right corner). `HOUSE` states: `closed`, `open`,
`night`.

---

## Settings

`electron-store`, defaults at the top of `main.js`. `CONFIG_MIN` floors the
numeric ones so a typed `0` can't wedge the app.

| Key | Default | Notes |
|---|---|---|
| `stretchIntervalMin` | 60 | min 1 |
| `waterIntervalMin` | 45 | min 1 |
| `overlaySeconds` | 10 | water overlay, min 3 |
| `bubbleMs` | 8000 | min 1000 |
| `walkSpeed` | 1.4 | **px per 16ms**, min 0.2 |
| `idleMinMs` / `idleMaxMs` | 8000 / 20000 | gap between wanders/flourishes |
| `character` | `raj` | one of the five keys |
| `palName` | `Chotu` | reset to the character's default on switch |
| `shirtColor` / `pantColor` | `default` | Raj only |
| `followCursor` | false | |
| `focusMoods` | false | app-reaction poses |
| **`boredomLadder`** | **true** | the whole ladder |
| **`dockTrip`** | **true** | rung 3 only — the one that walks him far, and macOS-only |
| `focusSessionMin` / `focusBreakMin` | 25 / 5 | min 1 each |
| `workSpot` | null | **the chair**; null = screen centre |
| `housePos` | null | null = default corner |
| `chotuVisible` | true | migrated from the old `petVisible` key |
| `quietHours` | off, 22:00–07:00 | |
| `startWithWindows` | false | `app.setLoginItemSettings` |
| `lastState`, `history` | | persistence |

`boredomLadder` and `dockTrip` have **no Settings-window toggle** — they're
menu/config only, by design for stage 1.

---

## Constants worth knowing

**Ladder** (`state.js`): `BOREDOM_RESET_MS` 2000 · `FIDGET_IDLE_MIN/MAX_MS`
2500/6000 · `STARTLE_MS` 700 · `MANUAL_GRACE_MS` 5000.

**Dock trip** (`state.js`): `DOCK_PASSES_MIN/MAX` 2/3 ·
`DOCK_PATROL_SPEED_FACTOR` 0.55 · `DOCK_ASK_MS` 20000 · `DOCK_SPAN_FRACTION` 0.55
(patrol the middle, not into the corners) · `DOCK_MIN_SPAN_PX` 60 (skip the rung
on a tiny display rather than twitch on the spot) · `DOCK_PAD_PX` 24.

**Movement** (`state.js`): `REFERENCE_TICK_MS` 16 · `FACING_EPSILON_PX` 1.5 ·
`DRAG_HOLD_MS` 8000 · `FOLLOW_DEADZONE_PX` 12 · `FOLLOW_SPEED_FACTOR` 0.7 ·
`PLAY_RADIUS_PX` 70 · `PLAY_MIN/MAX_HOPS` 3/6.

**Main loop** (`main.js`): `TICK_MS` 16 · `IDLE_SAMPLE_TICKS` 16 ·
`CURSOR_IDLE_MS` 3000 · `CURSOR_AT_DOCK_PX` 40 · `DOCK_REFRESH_MS` 60000 ·
`FOCUS_POLL_MS` 4000 · `FOCUS_REACTION_COOLDOWN_MS` 45000 · `PAL_W/H` 72 ·
`HOUSE_W/H` 120.

---

## Geometry

Three different rectangles, and mixing them up is a real source of bugs:

| | What |
|---|---|
| `display.workArea` | Excludes the menu bar and a **pinned** Dock. The pal's window is this size, so it bounds where he can walk. |
| `display.bounds` | The full screen. Cached as `displayBounds` because `cursorNearDock()` needs the strip `workArea` excludes, every tick. |
| `roamBounds()` | The walkable rectangle in local window coordinates. |

`display-metrics-changed` refreshes all of it, re-clamps the pal and the house,
re-derives the patrol line (or abandons the patrol back to the chair), and
re-reads the Dock.

---

## Testing behaviour

Because `state.js` is pure, drive it directly — no Electron, no waiting:

```js
const { PalState } = require('./state.js');
const p = new PalState({ bounds: { minX: 0, maxX: 1728, minY: 39, maxY: 1097 },
                         houseDoor: { x: 1600, y: 60 }, startX: 300, startY: 900,
                         flourishes: { sit: 2 } });
p.setChair({ x: 800, y: 500 });
p.setDock({ edge: 'left', hidden: false, tileSize: 41 });
// 2.5 minutes of nobody touching anything.
for (let t = 0; t <= 150000; t += 16) { p.setSystemIdleMs(t); p.tick(16); }
console.log(p.state, p.animation, 'rung=' + p.bored, p.x, p.y);
// → SULKING sit rung=2 800 500   (walked to the chair and sat down)
```

Note what that example does *not* show: rung 1 leaves `state` and `animation`
alone, because fidgeting only shortens the idle timer. Assert on `p.bored` for
rung 1, not on the pose.

**Wait for a state, never sleep for a duration.** This is the trap that produced
every false failure while building the ladder: sampling at 45s when the whole
patrol takes ~22s finds him back in his chair and looks like a bug. Use an
`until(pred, cap)` helper.

Four harnesses live in `test/`, 298 assertions between them, all passing:

```bash
npm test          # test/ladder-sim.js (30), then test/play-sim.js (29),
                  # test/facing-sim.js (205), then test/fetch-sim.js (34)
```

- `test/ladder-sim.js` — escalation: every rung in order, reminders winning,
  focus sessions, input at each rung, all three Dock edges, pinning mid-patrol,
  losing the Dock, both feature switches, bed/drag interruptions.
- `test/play-sim.js` — the Play menu, **with the mouse held active throughout**,
  which is what actually happens when someone clicks a menu item to watch it, and
  the case that broke twice.
- `test/facing-sim.js` — sprite mirroring: every frame a character plays has to face
  the same way, asserted against `tools/frame-facing.js` rather than against pixels.
- `test/fetch-sim.js` — the dog's fetch loop: run to the thrown bone, pick it up,
  carry it back to the cursor, drop it, then sit and stare until it's thrown again.

Two Electron probes are there too, for the questions a headless harness cannot
answer (they print, they don't assert):

```bash
npx electron test/probe-idle-and-dock.js    # is getSystemIdleTime() usable? is the Dock read right?
npx electron test/probe-screen-insets.js    # does the screen API reveal the Dock? (no, when hidden)
```

**Environment variables** (both `main.js`):

| Variable | Effect |
|---|---|
| `MINIME_BOREDOM_SCALE=0.1` | Multiplies every rung time — 0.1 puts the doze rung 90s out instead of 15 min. Ignored unless it parses to a positive number, so a typo can't disable the feature. |
| `MINIME_DEBUG_LADDER=1` | Logs every state change with idle clock, rung, position and Dock. Silent otherwise. |

```bash
MINIME_BOREDOM_SCALE=0.1 MINIME_DEBUG_LADDER=1 npm start
```

---

## Things that look like bugs and are not

Hit in practice within minutes of the ladder going live:

- **Follow-cursor is on.** He chases the mouse, and the mouse movement that makes
  him chase is the same movement that resets the idle clock. He will essentially
  never get bored while you're steering him.
- **A focus session is running.** The ladder is suppressed entirely, by design.
  Nothing fires until the session ends, however still you sit.
- **The real waits are long** — 30s / 2min / 5min / 15min, deliberately. This is
  meant to be discovered, not performed at you. Use the Play menu or
  `MINIME_BOREDOM_SCALE`.
- **Raj dozing is a sit.** He has no lying-down art. That's why the `zzz` bubble
  exists. See [CHARACTERS.md](CHARACTERS.md).
- **`dog_walk_01` is unused.** Deliberate; adding it back makes the dog spin.
- **`bed` art is never displayed.** `SLEEPING` hides the sprite.

Neither of the first two prints anything without `MINIME_DEBUG_LADDER=1`, which is
why they're worth writing down.

Last verified against the tree on 2026-09-23.
