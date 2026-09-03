# PixelPal — Build Log, Corner Cases & Troubleshooting

Working notes from building PixelPal against `PIXELPAL-BUILD-PLAN.md`. Covers what
was built, real bugs found (with root cause), and design decisions made along
the way. Kept alongside the code so a future debugging session has the "why"
without re-deriving it.

---

## 1. Build process (what was done, in order)

1. **Skeleton** — `package.json`, `main.js` app lifecycle, tray icon, quit
   behavior (`window-all-closed` is a no-op — tray keeps the app alive).
2. **Pet window** — transparent, frameless, always-on-top `BrowserWindow`
   spanning the lane. Click-through via `setIgnoreMouseEvents(true, {forward:
   true})`, toggled off/on via `hover:enter`/`hover:leave` IPC driven by
   `mousemove` bbox checks in the renderer.
3. **Sprite slicing** (`tools/slice-sheet.js`) — connected-component labeling
   on the 1536×1024 reference sheet, filtered to exactly 31 shapes, sorted
   into reading order, cropped, bottom-aligned into 96×96 transparent PNGs.
   Gate: script hard-fails if the count isn't exactly 31 (no silent threshold
   loosening). See §3.1 for a major bug found here after initial ship.
4. **State machine** (`state.js`) — pure, no Electron imports, drives pal
   position/animation/house state via `tick(dtMs)`. Verified standalone with
   `node -e "require('./state.js')"` scripts (no Electron needed to test the
   logic).
5. **House** — CSS-drawn (no house art supplied), right-click context menu,
   Sleep/Wake drives `GOING_HOME → ENTERING_HOUSE → SLEEPING` and
   `WAKING → EXITING_HOUSE → IDLE`.
6. **Stretch reminder** — hourly (default), walk-to-center, bubble only, no
   blocking.
7. **Water overlay** — full-screen click-blocking window, 10s countdown ring,
   Esc/Skip dismiss, closes itself on focus loss (Alt+Tab).
8. **Config + Settings window** — `electron-store`, live-editable via a small
   settings UI, applied without restart via a `config:update` broadcast.
9. **Packaging** — `electron-builder` NSIS config is in `package.json`; not
   yet run end-to-end (`npm run dist`) — do this before first real install.

Post-v1 additions (requested after initial build):
- **Shirt/pants recolor** — live per-pixel recolor, not pre-baked variants.
- **Lane orientation** — horizontal (top edge, default) or vertical (right
  edge), switchable in Settings.

---

## 2. Corner cases found in code review (before any user testing)

Found by re-reading `main.js`/`state.js` end-to-end, not by running the app.

| # | Issue | Why it matters | Fix |
|---|---|---|---|
| 1 | **Reminder collision.** `requestReminder()` silently overwrote a pending reminder if a second kind arrived while the pal was already walking to deliver the first. | With default intervals (60min stretch / 45min water), the two timers land in the *same tick* every 180 minutes (LCM) — this wasn't a rare fluke, it was guaranteed every 3 hours of uptime, and one reminder would just vanish. | `state.js`: added a one-slot `_queuedReminder`. A colliding request is queued instead of dropped, and fires right after the current one completes. |
| 2 | **Tray crash on missing assets.** If `npm run slice`/`npm run placeholders` were never run, `tray.png` wouldn't exist. `nativeImage.createFromPath` on a missing file returns an empty image, and `new Tray(emptyImage)` can throw an opaque native error. | Bad first-run experience for a non-coder owner — a native stack trace with no actionable message. | `main.js`: `checkRequiredAssets()` runs before any window/tray creation; shows a plain-English `dialog.showErrorBox` naming the missing files and the two commands to run, then exits cleanly. |
| 3 | **Overlay self-dismiss race.** The water overlay's `blur` handler (`blur → close`, so Alt+Tab always escapes it) was live from window creation, but `.focus()` only happens inside the `did-finish-load` callback. A stray blur in that gap could close the overlay before the user ever saw it. | Overlay could flash and vanish instantly under bad timing. | Added a `readyForBlurClose` flag, only set `true` inside `did-finish-load`. Blur is ignored until then. |
| 4 | **No floor on config values.** Nothing stopped `stretchIntervalMin`, `waterIntervalMin`, `overlaySeconds`, `bubbleMs`, or `walkSpeed` from being set to 0 or near-0 (e.g. via a stray devtools call), which risked a runaway timer re-firing every tick. | Defense in depth — the Settings UI itself doesn't allow this, but IPC handlers shouldn't trust the renderer. | `main.js`: `CONFIG_MIN` map clamps every numeric config key to a sane floor in `setConfig()`. |

---

## 3. Bugs found during actual (visual) testing

These only showed up once the app was run and looked at on a real screen —
none of them were catchable by code review or by `node -e` logic tests, which
is itself worth remembering: **anything involving real pixels, real timing,
or real window compositing has to be eyeballed.**

### 3.1 Transparent holes in the sprite ("body color changes with background")

**Symptom:** user reported the character's cap and part of the shirt seemed
to take on whatever color the desktop wallpaper was — reported as "all reds
inside body is bad."

**Root cause:** the original slicer computed per-pixel alpha with a flat
color-distance test against the sheet's flat backdrop
(`rgb(23,29,38)`, tolerance 40). That test was applied uniformly to *every*
pixel in the crop, including pixels **inside** the character whose own dark
shading (cap crease, collar shadow) happened to fall within that same
tolerance band. Those interior pixels got `alpha = 0`, punching a hole clean
through the sprite. Since the pet window is `transparent: true`, anywhere the
PNG has `alpha = 0` shows the real desktop through it — hence "color matches
the background," because it literally *is* the background, showing through a
hole.

**Verification method:** reproduced deterministically by compositing the
sprite over solid red vs. solid green backgrounds with `sharp` and diffing —
if a spot changes color between the two, it's a hole; if it stays the same,
it's real art. This is a fast, cheap way to validate any future sprite change
without relying on eyeballing a live transparent window.

**Fix, in two layers** (`tools/slice-sheet.js`):
1. **Border-flood-fill background detection** (`computeTrueBackgroundMask`) —
   instead of testing every pixel's color independently, flood-fill outward
   from the sheet's four border edges through background-colored pixels
   only. A pixel only counts as "true background" if it's actually reachable
   from outside the character. This alone fixed most interior shading holes
   (e.g. within the shirt) but *not all* of them.
2. **Morphological closing, radius 2** (`closeAlpha` — dilate then erode) —
   some remaining holes (a stipple pattern in the hair, a hole in the walk
   pose's chest) turned out to be genuinely connected to background through a
   thin 1–4px seam in the *source AI-generated art itself* (not a masking
   bug — a real defect/gap in the sprite sheet). Flood-fill alone can't fix
   that since those pixels are legitimately reachable. A small closing pass
   patches thin notches regardless of true connectivity.

   Radius 1 was tried first and wasn't enough (speckling and the chest hole
   both persisted). Radius 2 closed both cleanly without visibly fusing any
   legitimate silhouette gaps (checked against the walk-cycle frame, where
   the gap between the two legs is real art and needs to stay transparent —
   it did).

**Insight for next time:** if new sprite sheets are supplied later, rerun the
red/green background diff test on a few frames before trusting the slice —
don't assume the flood-fill + closing combo generalizes to different art
styles without a quick check.

### 3.2 Pal "flash-runs" instead of walking (units bug)

**Symptom:** the pal appeared to teleport/dash between positions instead of
visibly walking, especially noticeable during go-to-sleep and reminder
walk-to-center.

**Root cause:** `state.js` computed movement as
`x += direction * walkSpeed * dtMs`, where `dtMs` is the full tick duration
(16ms) and `walkSpeed` defaults to `1.4`. That's `1.4 × 16 = 22.4px` per
16ms tick — **1400px/second**. The `walkSpeed` config value was clearly
calibrated assuming "px per tick," not "px per millisecond," so multiplying
by the raw millisecond count was off by a factor of 16.

**Fix:** introduced `REFERENCE_TICK_MS = 16` and changed the formula to
`x += direction * walkSpeed * (dtMs / REFERENCE_TICK_MS)`. At the actual
16ms tick rate this now moves exactly `walkSpeed` px per tick (~87px/sec at
the default `1.4`), while staying frame-rate independent if `dtMs` ever
varies. Verified with a standalone script: crossing a 1900px lane went from
~1.4 seconds to ~22 seconds.

**Insight:** this is exactly the kind of bug `state.js` being pure/Electron-free
made trivial to catch — a five-line `node -e` script simulating 1000 ticks
and checking elapsed distance found it immediately, no need to launch the
app.

### 3.3 Pal invisible in vertical lane orientation

**Symptom:** switching "Lane orientation" to Vertical in Settings made the
pal disappear entirely — house was visible, pal was not, anywhere.

**Root cause:** the renderer (`renderer/pet.js`) sets the pal's screen
position by writing an inline style each tick: `palEl.style.left = ...` in
horizontal mode, `palEl.style.top = ...` in vertical mode. The CSS for
vertical mode (`body.vertical #pal { left: 50%; ... }`) was written to
re-center the pal — but **inline styles always win over stylesheet rules,
regardless of selector specificity or class.** Since horizontal mode had
already written a `left: <big number>px` inline style before the switch, and
nothing ever cleared it, that stale inline `left` stayed in effect and
overrode the vertical CSS's `left: 50%`. The vertical window is only 170px
wide, so a leftover horizontal-mode `left` value (easily in the hundreds of
pixels) placed the pal completely outside the window's own clipping bounds —
not just visually wrong, but literally not rendered at all.

**Fix:** on every tick, explicitly clear the *other* axis's inline style
(`palEl.style.left = ''` when in vertical mode and vice versa), for both the
pal element and the speech bubble (same leak existed there).

**Insight:** any time a renderer toggles between two mutually-exclusive
inline-style-driven layouts, explicitly blank the unused property every
update — don't rely on a CSS class rule to "win," because it structurally
can't against an inline style.

### 3.4 House repositioning (vertical mode semantics)

Initial vertical-mode implementation put the house at the **bottom** of the
right-edge lane (mirroring the horizontal layout's "house at the far end").
User clarified the intended behavior was the opposite: house at the **top**,
pal walks **down** toward the bottom of the screen on wake. Fixed by
swapping which end of the vertical range the house occupies in
`laneBounds()` (`main.js`) and moving the CSS-drawn house to `top: 0` instead
of `bottom: 0` in vertical mode. `state.js` itself needed zero changes for
this — the state machine only ever walks toward whatever `houseDoorX` is
handed to it, direction-agnostic by construction, so swapping which end of
the lane the house sits on in `main.js` was sufficient.

**Insight:** keeping `state.js` axis/direction-agnostic (it doesn't know if
"x" means screen-x or screen-y, or which end is "home") is what made both the
horizontal→vertical feature and the top-vs-bottom house fix cheap — all the
orientation-specific logic lives in `main.js` (geometry) and the renderer
(CSS/positioning), never in the state machine.

---

## 4. Known limitations (by design, not bugs)

- **Vertical mode has no real up/down walk cycle.** The sprite sheet only has
  side-view (left/right) walk frames. In vertical mode the pal plays the same
  side-view walk animation while translating vertically, with left/right
  mirroring disabled (there's no correct facing to mirror to). This will
  always look slightly off compared to horizontal mode unless a proper
  up/down pose set is added to the source art later.
- **Primary display only.** Multi-monitor setups are not crashed on, but the
  pal only ever uses `screen.getPrimaryDisplay()`.
- **Shirt/pants recolor is a heuristic, not exact garment layers.** The
  source art has no separate shirt/pants layers, so recoloring works by
  classifying near-neutral (low-saturation) pixels into "upper 58% of the
  figure's bounding box = shirt" / "lower 42% = pants," then HSL-colorizing
  (keep each pixel's original lightness, swap in the target hue/saturation).
  This preserves shading correctly but can show minor fringing at the
  shirt/pants boundary on close inspection, since the split is a fixed
  fraction of each frame's bounding box, not a true segmentation.
- **Installer (`npm run dist`) has not been run end-to-end yet.** Do this
  before distributing a `.exe` — `electron-builder`/NSIS config is in place
  but unverified.

---

## 5. Packaging & distribution corner cases

Found while making the project installable/shippable to GitHub. Both were only
catchable by *actually building and running the packaged output* — neither
shows up when running from source with `npm start`.

### 5.1 `tray.png` was excluded from the packaged app (would ship broken)

**Symptom (latent):** the app worked perfectly from source but the packaged
build would have failed on launch with the "assets missing" dialog.

**Root cause:** the `build.files` allowlist in `package.json` included
`assets/*.ico` but the tray icon is `assets/tray.png` — a `.png`, which
matched no pattern. `electron-builder`'s `files` field is an allowlist, so
anything not matched is silently omitted from the `app.asar`. At runtime
`checkRequiredAssets()` (added earlier, see §2 item 2) would find `tray.png`
missing and exit with an error dialog.

Ironic upside: the asset guard added defensively in code review is exactly
what would have made this fail loudly and clearly instead of throwing an
opaque native `Tray` error.

**Fix:** replaced the glob with explicit entries (`assets/icon.ico`,
`assets/icon.png`, `assets/tray.png`) and added explicit negations for things
that must **not** ship (`!assets/reference/**` — the 1.7MB source sheet,
`!tools/**`, `!**/*.md`).

**Verified by:** `npx asar list dist/win-unpacked/resources/app.asar` and
confirming `\assets\tray.png` is present and `reference/`, `tools/`, and
`.md` files are absent — then launching `dist/win-unpacked/MiniMe.exe` and
confirming it starts with no error dialog.

**Insight:** never trust an `electron-builder` `files` allowlist by reading
it. Build once, list the asar, and run the packaged binary. A glob that looks
right is not evidence.

### 5.2 `electron-builder` fails on Windows: "Cannot create symbolic link"

**Symptom:** `npm run dist` aborts with
`ERROR: Cannot create symbolic link : A required privilege is not held by the
client. : ...\winCodeSign\...\darwin\10.12\lib\libcrypto.dylib`, retries once,
then exits 1.

**Root cause:** `electron-builder` downloads a `winCodeSign` toolchain archive
that bundles **macOS** `.dylib` files stored as *symlinks*. Creating symlinks
on Windows requires either Developer Mode or elevated rights. On this machine
Developer Mode was off (confirmed: the registry value
`HKLM\...\AppModelUnlock\AllowDevelopmentWithoutDevLicense` did not exist), so
7-Zip failed on those two entries and `electron-builder` treated the whole
extraction as failed.

Note the darwin files are **completely irrelevant to a Windows build** — the
build only needs `rcedit-x64.exe` and the `windows-10` signtool from that same
archive.

**Attempted and rejected:** setting `CSC_IDENTITY_AUTO_DISCOVERY=false` does
*not* help — the toolchain is downloaded regardless of whether signing is
actually configured, because `rcedit` (used to stamp the exe icon/version)
lives in the same archive.

**Two valid fixes:**
1. **Proper fix (recommended for contributors):** enable
   *Settings → System → For developers → Developer Mode*, then rebuild. This
   grants unelevated symlink creation permanently.
2. **Workaround used here (no admin, no settings change):** pre-seed the build
   cache by extracting the archive manually while skipping the darwin folder:
   ```bash
   cd "$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
   7za.exe x -bd -y <downloaded>.7z -o"winCodeSign-2.6.0" "-xr!darwin"
   ```
   `electron-builder` finds `winCodeSign-2.6.0` already present and skips both
   the download and the extraction. Extracted 83 files across 7 folders with
   everything a Windows build needs.

   Also delete the numeric temp dirs (`012536075/`, etc.) left behind by the
   failed attempts, or they accumulate.

**Not an issue in CI:** GitHub Actions `windows-latest` runners have symlink
privileges, so `.github/workflows/release.yml` builds cleanly without any of
this. This is purely a local-Windows-machine problem.

### 5.3 Distribution design decisions

- **Sprite frames are committed to the repo** rather than generated on
  install. A `postinstall` slice step would force every user to successfully
  build `sharp` (a native module, ~large, fails on some setups) just to run a
  desktop pet. Committing the 31 generated PNGs costs ~288KB and makes
  `npm install && npm start` work everywhere with zero native toolchain.
- **`sharp` and `to-ico` moved to `optionalDependencies`.** They're needed
  only to *regenerate* art. As `devDependencies` a failed native build would
  abort the whole `npm install` and leave the user with nothing; as
  `optionalDependencies` npm continues on failure. Both `tools/` scripts now
  fail with a clear "install these, you only need them for X" message instead
  of a raw `MODULE_NOT_FOUND`.
- **The 1.7MB source sheet is committed but excluded from the package** —
  kept in git for reproducibility (so the slicer can be re-run), stripped
  from the shipped app where it's dead weight.
- **NSIS installer is `perMachine: false`** so installation needs no admin
  rights.
- **The installer is unsigned**, so SmartScreen will warn on first run. This
  is called out honestly in the README rather than hidden; code signing needs
  a paid certificate.

---

## 6. Corner cases from the 2D / free-roam rework

Moving from a 1D lane to whole-screen roaming changed the risk profile — the
pet window went from a 140px strip to covering the entire work area, which
turned several previously-harmless issues into serious ones.

| # | Issue | Why it matters | Fix |
|---|---|---|---|
| 1 | **The whole screen could stop accepting clicks.** Hover tracking is deliberately skipped during a drag, so `hovering` stayed `true` after dropping the pal with the cursor elsewhere — leaving the window non-click-through. | Harmless as a 140px strip; with a full-screen window it swallows *every* click on the desktop, taskbar, and other apps until the next mousemove. | `finishDrag()` in `renderer/pet.js` re-evaluates hover immediately using the last known cursor position. |
| 2 | **Dragging the house wrote to disk on every mousemove.** `electron-store` persists synchronously. | Measured at ~1.5ms per write; a 3-second drag at ~90Hz is ~270 writes ≈ **408ms of blocking disk I/O** on the same thread as the 16ms animation tick — visible stutter plus pointless SSD wear. | Position is held in memory (`liveHousePos`) during the drag and written once on drop (`commitHousePos()`). |
| 3 | **Holding the pal still for 1.5s dropped it.** The drag watchdog only re-armed on drag *messages*, and holding the mouse still produces none. | The watchdog couldn't distinguish "user is holding it" from "renderer died". | The renderer sends a heartbeat every 400ms while a drag is held; watchdog raised to 2s. |
| 4 | **The focus watcher could silently stop forever.** If the PowerShell helper wedged mid-request, `focusPending` stayed `true` and no further polls were issued. | Moods would quietly stop with no error and no recovery. | The poll loop times out a stuck request after 3 intervals and resets. |
| 5 | **The pal could walk across the water overlay.** Both windows sit at `screen-saver` level, so z-order between them is not guaranteed. | Only worked before because the pal was confined to a thin strip. | The pet window hides for the overlay's duration and restores afterwards, respecting the Hide setting. |
| 6 | **`HOUSE_H` was stale at 128** after the real house art (square) replaced the CSS house. | It feeds the doorway calculation, so the pal walked to a point ~32px above the real door — it would have appeared to enter through the wall. | One consistent constant across slicer, main process, and renderer, with cross-referencing comments. |
| 7 | **Wave while sitting left the pal stuck standing.** The sit branch was guarded by `if (state !== RESTING)`, but state was *already* `RESTING` with the animation overwritten to `wave`. | A state-guarded assignment can never repair an animation desync — the pal would never sit again. | Drive the animation off the animation, not the state. |
| 8 | **Enabling follow mid-wander was ignored for up to ~20s** while the pal finished its random walk. | Looked broken right after toggling the setting on. | `setFollow(true)` abandons a plain wander target — but explicitly *not* a walk that is delivering a reminder. |
| 9 | **Sending the pal to bed mid-focus-session** left `_focusActive` true. | Main's session clock kept running and would try to start a break while the pal was asleep in the house. | `requestSleep()` ends the session and emits `focusStopped` so main clears its timers. |

### Art masking, second time around

The house sheet needed a **different background tolerance than the character
sheet** (25 vs 40). At 40 the flood fill seeped through the jagged shingle gaps
and hollowed out the roof, because the roof's dark mortar lines sit at colour
distance 30-40 from the backdrop while the true backdrop sits at ≤20. This was
found by histogramming the colour distances in the roof region rather than by
guessing.

**Lesson:** the red/green background composite test (§3.1) must be re-run for
every new art sheet. Masking constants do not transfer between sheets.

---

## 7. Quick reference: rebuilding assets after art changes

```
npm run slice              # re-cut assets/pal/*.png from assets/reference/spritesheet.png
npm run placeholders       # regenerate assets/icon.ico, assets/icon.png, assets/tray.png
node tools/slice-house.js  # re-cut assets/house/*.png from assets/reference/housesheet.png
```

Sprite size lives in `tools/slice-sheet.js` (`CANVAS`) and house size in
`tools/slice-house.js` (`OUT_W`). Both are re-sliced from the high-resolution
source rather than downscaling an already-generated PNG, which would soften the
pixel art. Changing either means updating the matching `PAL_W`/`PAL_H` or
`HOUSE_W`/`HOUSE_H` constants in `main.js` and `renderer/pet.js`, plus the CSS.

If a new sheet ever produces a raw component count that isn't exactly 31
after filtering, `tools/slice-sheet.js` stops and prints the count rather
than guessing — that's intentional (see §1, step 3). Investigate the
threshold constants (`BG`, `TOL`, and the `height/width/area` filter) rather
than loosening them blindly.
