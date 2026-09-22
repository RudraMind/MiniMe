# MiniMe on macOS — port notes, root-cause analysis, and open issues

This is a self-contained handoff document. It records what was changed to make
MiniMe run on macOS, why each change was necessary, how every claim in it was
verified, and what is still broken. It assumes no knowledge of the conversation
that produced it.

MiniMe was written for Windows. It now runs on macOS as well. Every platform
difference is behind an `IS_MAC` branch and no shared code path was rewritten,
so Windows behaviour is preserved — with two deliberate exceptions, both
cross-platform art defects fixed for both platforms: a sprite-mirroring bug
([2.14](#214-raj-walks-backwards--rendereranimationsjs-a-real-bug-fixed)) and
transparent holes in the sprite art
([2.15](#215-white-specks-in-rajs-hair--toolsslice-sheetjs-a-real-bug-fixed)).

**Status:** the macOS port is complete, packages successfully, and has been
launched and confirmed running on macOS.

Seven pre-existing, platform-independent bugs were found during review. Two —
the default character walking backwards, and white specks in his hair — were
fixed, because both are visible within seconds of launch. The other five are
documented in [Part 5](#part-5--known-issues-not-fixed) with runnable
reproductions and were **deliberately left unfixed**, to keep this change
reviewable as a port rather than mixing in behavioural changes to the reminder
logic.

---

## Scope — what here is macOS-specific, and what isn't

Despite the filename, **this document is not entirely about macOS.** Reviewing
the port surfaced problems that have nothing to do with the platform, and they
are included because losing them would be worse than filing them tidily. Use
this table to know which is which.

| Section | Scope |
|---|---|
| 0 — Environment | macOS, except the Node/nvm notes |
| 1.1 — `npm install` TLS failure | **Cross-platform** — any TLS-inspecting corporate network |
| 1.2–1.5 — XProtect blocking Electron | macOS only |
| 2.1–2.12 — Dock, Spaces, overlay, tray, focus helper, packaging, launcher | macOS only |
| 2.13 — "Start at login" wording | **Cross-platform** — Windows users see the new label too |
| 2.14 — Raj walking backwards | **Cross-platform** — the bug and the fix apply to Windows equally |
| 2.15 — White specks in Raj's hair | **Cross-platform** — the assets ship to both platforms |
| 2.16 — `electron-store` must stay on v8 | **Cross-platform** constraint |
| 3.1–3.3 — Verification | macOS |
| 3.4 — The `NaN` non-bug | **Cross-platform** |
| 4 — Corrections | macOS |
| **5 — All five known issues** | **Cross-platform** — every one affects Windows identically |
| 6 — Residual risk | macOS, except item 7 |
| A — Reproductions | Issues 1/2 repros are cross-platform; helper and packaging are macOS |

### Four changes alter Windows behaviour

Anyone merging this needs to know that the port is **not** a pure additive
macOS-only change. Four of the edits are shared, all four verified:

1. **Electron was upgraded from 31 to 44 for both platforms.** `electron` is a
   single shared `devDependency`, not per-platform, and `npm run dist`
   (`electron-builder --win`) reads the same entry. **Windows builds now ship
   Electron 44 / Chromium 152.0.7977.78** (the running version was read from
   `process.versions`; the Chromium version previously shipped with Electron 31
   was not verified here, so the size of the Chromium jump is stated only as
   "13 Electron majors"). This was forced by macOS — Electron 31 cannot execute
   there at all, see
   [Part 1](#part-1--the-blocker-electron-would-not-execute-at-all) — but it
   lands on Windows too, and a jump of that size deserves a Windows smoke test
   before release. **No Windows testing was done as part of this work.**
2. **The Settings label changed for everyone.** "Start with Windows" is now
   "Start at login" on Windows as well. The element `id` and stored config key
   remain `startWithWindows`, so no existing install loses its setting.
3. **The Raj facing fix applies to Windows.** `renderer/animations.js` and
   `renderer/chotu.js` contain no platform branches at all (verified: zero
   occurrences of `IS_MAC`, `process.platform`, or `darwin`), so Raj was walking
   backwards on Windows too and now does not.
4. **The sprite assets were regenerated.** The hair-speck fix
   ([2.15](#215-white-specks-in-rajs-hair--toolsslice-sheetjs-a-real-bug-fixed))
   changes `tools/slice-sheet.js` and rewrites all 31 frames in `assets/pal/`,
   which ship to both platforms. The specks were only *noticed* on macOS but
   were never macOS-specific.

Everything else in Part 2 is behind an `IS_MAC` branch and cannot affect
Windows.

---

## Table of contents

- [Scope — what here is macOS-specific, and what isn't](#scope--what-here-is-macos-specific-and-what-isnt)
- [Part 0 — Environment](#part-0--environment)
- [Part 1 — The blocker: Electron would not execute at all](#part-1--the-blocker-electron-would-not-execute-at-all)
- [Part 2 — The macOS port, change by change](#part-2--the-macos-port-change-by-change)
- [Part 3 — Verification log](#part-3--verification-log)
- [Part 4 — Corrections](#part-4--corrections)
- [Part 5 — Known issues (not fixed)](#part-5--known-issues-not-fixed)
- [Part 6 — Untested and residual risk](#part-6--untested-and-residual-risk)
- [Appendix A — Reproducing the verification](#appendix-a--reproducing-the-verification)
- [Appendix B — Files changed](#appendix-b--files-changed)

---

## Part 0 — Environment

Everything below was verified on this configuration. Facts that depend on it are
marked as such.

| | |
|---|---|
| macOS | 26.5.1 (build 25F80) |
| Architecture | arm64 (Apple Silicon) |
| XProtect | 5358 |
| Node | v24.21.0 (installed via nvm, no admin rights needed) |
| npm | 11.19.0 |
| Electron | 44.3.0 (Chromium 152.0.7977.78, Node 24.20.0) |
| electron-builder | 24.13.3 |
| electron-store | 8.2.0 (depends on `conf` 10.2.0) |

Two environment notes that will bite anyone reproducing this:

1. **Node installed via nvm is not on a non-interactive `PATH`.** Any script,
   scheduled job, or double-clicked `.command` file must source
   `~/.nvm/nvm.sh` first. `START-MINIME.command` does this.
2. **A corporate TLS-inspecting proxy breaks `npm install`.** See
   [Part 1.1](#11-first-failure-npm-install-cannot-download-electron).

---

## Part 1 — The blocker: Electron would not execute at all

Before any porting work could be evaluated, the app could not start. This
section is the most useful part of the document for anyone else hitting it,
because the failure mode is silent and the obvious diagnoses are all wrong.

### 1.1 First failure: `npm install` cannot download Electron

```
npm error self-signed certificate in certificate chain
```

Raised from Electron's `install.js` postinstall script, not from npm's registry
client. The cause is a TLS-inspecting corporate proxy: it presents its own root
CA, which is trusted by the macOS system keychain but **not** by the certificate
list bundled into Node. Electron's downloader uses that bundled list, so npm
itself succeeds while Electron's binary fetch fails.

**Fix** — tell Node to trust the system keychain:

```sh
NODE_OPTIONS=--use-system-ca npm install
```

This is the only reason `START-MINIME.command` sets `NODE_OPTIONS`. On a network
without TLS inspection it is harmless.

### 1.2 Second failure: Electron 31.7.7 was killed by the operating system

With the download working, `npm start` hung and never opened a window. Directly
executing the binary produced:

- the process being `SIGKILL`ed,
- `node_modules/electron/dist/Electron.app` **deleting itself** from disk,
- a macOS dialog: *"Malware Blocked — 'Electron' was not opened because it
  contains malware. This action did not harm your Mac."*

**Root cause: macOS XProtect blocked the binary.** Apple revoked the
notarization ticket for Electron 31.7.7, and XProtect enforces that revocation
by refusing execution and removing the bundle. This is not a compromised
download and not a misconfiguration — the exact upstream release artifact is
rejected.

The downloaded archive was byte-for-byte the official release:

```
sha256  e81b75a185376effcc7dd15aef8877ab48474633e5ac7417810a3b28e694bbfa
        electron-v31.7.7-darwin-arm64.zip   (96,569,232 bytes)
```

### 1.3 What was ruled out, and how

Each of these was tested and eliminated. They are listed because they are the
diagnoses a reasonable person reaches for first, and all of them are wrong.

| Hypothesis | Test | Result |
|---|---|---|
| Corrupt / truncated download | `shasum -a 256` vs upstream release | Identical. Not corruption. |
| Bad archive extraction losing the signature | Re-extracted with `ditto -xk` (preserves metadata; `unzip` does not) | Identical outcome. Still killed. |
| Missing or invalid code signature | Re-signed ad-hoc with `codesign`; signature then verified as valid | Still killed. Signing is not the gate. |
| Chromium sandbox failing to initialise | Launched with the sandbox disabled | Still killed. |
| Not actually a GUI problem | `ELECTRON_RUN_AS_NODE=1` (pure Node mode, no window) | Still killed. Not GUI-related. |
| Wrong architecture | `file` on the Mach-O binary | `Mach-O 64-bit executable arm64`. Correct. |
| Endpoint security (EDR) agent | See controls below | Contradicted by the controls. |

**Two controls proved the machine could run this class of binary:**

1. A locally compiled, ad-hoc-signed binary executed normally — so ad-hoc
   signing is not blocked as a policy.
2. Other Electron applications already installed on the machine (on Electron
   42) executed normally — so Electron as a framework is not blocked.

Together these show the block was **specific to that binary's content**, which
is exactly how an XProtect malware/revocation rule behaves and is not how a
signing-policy or EDR-policy block behaves.

### 1.4 Resolution: upgrade to Electron 44.3.0

```diff
- "electron": "^31.0.0"
+ "electron": "^44.3.0"
```

Electron 44.3.0 executes:

```
$ ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
    -e 'console.log(process.versions.electron, process.versions.chrome)'
44.3.0 152.0.7977.78
```

**The decisive evidence that signing was never the problem** is that 44.3.0 has
an *identical* signing posture to the version that was killed:

```
$ codesign -dv --verbose=2 node_modules/electron/dist/Electron.app
Identifier=Electron
CodeDirectory v=20400 ... flags=0x20002(adhoc,linker-signed)
Signature=adhoc
TeamIdentifier=not set
```

Same ad-hoc signature, same absent team identifier, and `spctl` reports the same
`code has no resources but signature indicates they must be present`. One runs,
one is destroyed on sight. The difference is content-based reputation, not
policy.

Note also that the cached archive carried **no `com.apple.quarantine`
attribute** (npm's downloader does not set one), so this was not a
quarantine-triggered Gatekeeper prompt. XProtect's known-malware rules apply
regardless of quarantine state.

### 1.5 Practical guidance

- **Do not pin Electron 31.x for macOS.** It cannot run on a current macOS, and
  no amount of re-signing changes that.
- If you see "contains malware" for a developer tool, check whether the vendor's
  notarization was revoked before assuming your machine is compromised.
- The blocked archive was intentionally retained at
  `~/Library/Caches/electron/<hash>/electron-v31.7.7-darwin-arm64.zip` so a
  security team can inspect it. Delete it once it is no longer needed.
- Electron 44 sets `LSMinimumSystemVersion` to **13.0**, so the packaged app
  requires macOS 13 or newer. This is a real drop in support surface versus
  Electron 31 and should be a conscious decision.

---

## Part 2 — The macOS port, change by change

All changes are guarded by:

```js
const IS_MAC = process.platform === 'darwin';
```

Every macOS API used below was checked against the `@platform` annotations in
the shipped `node_modules/electron/electron.d.ts`, not from memory. The
annotations are quoted in [Part 3.1](#31-electron-api-platform-annotations).

### 2.1 Hide the Dock icon — `main.js`

```js
app.whenReady().then(() => {
  if (IS_MAC && app.dock) app.dock.hide();
  ...
```

A desktop companion belongs in the menu bar, not the Dock or ⌘-Tab. On Windows
`skipTaskbar` on each window achieves this; on macOS the *process* must be
demoted to an accessory, and that must happen before any window is created.

The `app.dock &&` guard is not defensive noise — the typings declare
`readonly dock: (Dock) | (undefined)`, so it is genuinely `undefined` off macOS.

Electron documents a known issue: calling `dock.hide()` twice within one second
silently does nothing. **This code calls it exactly once**, at
`main.js:1007`, so the issue does not apply. Verified: `grep -n dock main.js`
returns one call site.

This single line is what makes the two `app.focus({ steal: true })` calls below
necessary — accessory apps cannot raise their own windows.

### 2.2 Keep the pet visible across Spaces — `main.js`, `createChotuWindow()`

```js
if (IS_MAC) {
  chotuWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
}
```

Without this the pet exists only on the desktop where it was created and
disappears when you switch Spaces or enter a fullscreen app.

`skipTransformProcessType: true` is **required, not cosmetic**. The default path
flips the process between accessory and foreground and hides the window each
time the call is made, which visibly flickers the pet on a Dock-hidden app.

### 2.3 Replace native fullscreen for the water overlay — `main.js`

The water overlay is a full-screen dimmer that lives about ten seconds. On
Windows `fullscreen: true` is correct. On macOS it is the wrong primitive: it
requests *native* fullscreen, which animates the window into a Space of its own
over roughly a second and interferes with transparency — a heavyweight
desk-clearing transition for a brief dimmer.

The inline options object was extracted into `overlayWindowOptions()`:

```js
if (!IS_MAC) return { ...base, fullscreen: true };
return { ...base, ...screen.getPrimaryDisplay().bounds, movable: false, hasShadow: false };
```

Sizing to the display is instant and identical in effect, because the
`'screen-saver'` window level already draws above the menu bar and Dock.

`display.bounds` is used deliberately rather than `workArea`, so the menu bar
dims too. `hasShadow: false` removes the drop shadow a borderless full-screen
window would otherwise cast; the typings show `hasShadow` has no `@platform`
restriction, so it is a valid cross-platform option.

### 2.4 Let the overlay receive keystrokes — `main.js`

```js
overlayWindow.webContents.once('did-finish-load', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (IS_MAC) app.focus({ steal: true });
  overlayWindow.focus();
  ...
```

Accessory apps cannot bring themselves forward with `focus()` alone, so without
`app.focus({ steal: true })` the overlay draws on top but never receives the
Escape keypress.

The `isDestroyed()` guard is a real fix, not boilerplate: the overlay can be
dismissed before it finishes loading, in which case this callback fires with the
window already gone.

### 2.5 Do not steal Escape system-wide — `main.js`

```js
if (!IS_MAC) globalShortcut.register('Escape', escHandler);
...
if (!IS_MAC) globalShortcut.unregister('Escape');
```

Windows needs a global grab because its overlay can sit unfocused behind a
foreground app. On macOS the overlay is explicitly focused (2.4), so its own
renderer handles Escape — and a *system-wide* Escape grab would swallow the key
for every other application for as long as the overlay is up.

Verified that the renderer really does handle it, at `renderer/overlay.js:60`:

```js
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismiss('esc');
});
```

and that `overlay:dismiss` is on the preload send allowlist (`preload.js:5`).
There are three independent dismissal paths — Escape, the Skip button
(`overlay.js:64`), and the countdown timing out — plus a `blur` handler, so the
overlay cannot become a stuck full-screen window even if focus fails.

### 2.6 Raise the Settings window — `main.js`, `createSettingsWindow()`

```js
if (IS_MAC) app.focus({ steal: true });
```

Same accessory-app reason as 2.4: Settings would otherwise open *behind*
whatever you were working in.

### 2.7 A correctly sized menu bar icon — `main.js` + new assets

```js
const iconFile = IS_MAC ? 'tray-mac.png' : 'tray.png';
```

The Windows tray art is 32×32, which the macOS menu bar renders at 32 **pt** —
roughly twice the height of every system item. macOS gets a 16 pt icon;
`nativeImage` automatically picks up the neighbouring `tray-mac@2x.png` for
Retina.

New assets:

| File | Size | Note |
|---|---|---|
| `assets/tray-mac.png` | 16×16 | menu bar, 1× |
| `assets/tray-mac@2x.png` | 32×32 | menu bar, Retina (identical bytes to `tray.png`) |
| `assets/icon.icns` | 1024×1024 source, all 10 representations | app/DMG icon |

The icon is deliberately left **in colour rather than as a template image**: a
black silhouette loses the character, and the art is light enough to read
against dark mode.

### 2.8 App-focus reactions without a permission prompt — `main.js`

The "react to the app I'm using" feature needed a macOS equivalent of its
Windows PowerShell helper. Two design constraints were preserved: one
long-lived process rather than one spawn per poll (a spawn every few seconds is
real battery drain), and no native module (keeps `npm install` compile-free).

```sh
while IFS= read -r _; do
  name=""
  asn=$(lsappinfo front 2>/dev/null)
  if [ -n "$asn" ]; then
    name=$(lsappinfo info -only name "$asn" 2>/dev/null | sed -n 's/.*"LSDisplayName"="\([^"]*\)".*/\1/p')
  fi
  printf '%s\n' "$name"
done
```

**`lsappinfo` was chosen specifically because it is a Launch Services query and
requires no Accessibility or Automation grant.** The obvious alternative —
AppleScript via System Events — returns the same information but triggers a TCC
permission prompt, which is a poor experience for a cosmetic feature and a
privacy escalation the feature does not need.

The helper blocks on stdin so it costs nothing between polls, and **always
prints exactly one line per ping**, including an empty line on failure.
That matters: the caller sets a `focusPending` flag before each poll and clears
it on receiving a line, so a silent failure would leave the flag set and stop
all future polling. (`startFocusWatcher()` also has a timeout that clears a
stuck flag after three poll intervals.)

`startFocusWatcher()` now returns early on platforms other than macOS and
Windows rather than spawning a helper that cannot exist.

### 2.9 Platform-specific app-name table — `main.js`

This is the subtle one. **Windows reports a bare process name (`msedge`); macOS
Launch Services reports a display name (`Microsoft Edge`).** Reusing one table
would leave the feature silently inert on macOS — it would run, cost battery,
and never match anything.

`MOOD_BY_APP` was therefore split:

```js
const MOOD_BY_APP = IS_MAC ? MOOD_BY_APP_MAC : MOOD_BY_APP_WIN;
```

`MOOD_BY_APP_WIN` is unchanged. `MOOD_BY_APP_MAC` is keyed on macOS display
names, lowercased (`'google chrome'`, `'visual studio code'`, `'zoom.us'`,
`terminal`, `finder`, …). Both are matched lowercased in `handleFocusApp()`.

Verified end to end: the helper emits `Terminal`, `handleFocusApp` lowercases it
to `terminal`, and `MOOD_BY_APP_MAC.terminal === 'crossed'`.

### 2.10 Startup asset check — `main.js`

```js
path.join(__dirname, 'assets', IS_MAC ? 'tray-mac.png' : 'tray.png'),
```

`checkRequiredAssets()` hard-fails the launch with a dialog if a required asset
is missing. Without this change it would look for the Windows tray icon and, in
a macOS-only build, abort at startup.

### 2.11 Packaging — `package.json`

```json
"mac": {
  "target": ["dmg", "zip"],
  "icon": "assets/icon.icns",
  "category": "public.app-category.productivity",
  "darkModeSupport": true,
  "extendInfo": { "LSUIElement": 1 },
  "identity": null
}
```

`LSUIElement: 1` is the packaged-build counterpart to `app.dock.hide()`: the
runtime call covers `npm start` during development, the plist key means the
shipped app never briefly shows a Dock icon at launch.

`identity: null` skips code signing for local builds. **This is not suitable for
distribution** — see [Part 6](#part-6--untested-and-residual-risk).

Also added: `dist:mac` / `pack:mac` scripts, the three new asset paths in
`files`, and a platform-neutral `description`.

### 2.12 A launcher for macOS — `START-MINIME.command` (new)

The macOS counterpart to the existing `.bat`. Double-clickable from Finder;
installs dependencies on first run, then starts the app. Handles the two
environment traps from Part 0: it sources `~/.nvm/nvm.sh` (falling back to
`/opt/homebrew/bin` and `/usr/local/bin`) because a double-clicked `.command`
gets a non-interactive shell, and it uses `NODE_OPTIONS=--use-system-ca` for the
install.

### 2.13 Wording — `renderer/settings.html`

"Start with Windows" → "Start at login".

The element `id` and the stored config key remain `startWithWindows` on purpose,
so existing Windows installs keep their saved choice. A comment in the file
records this, because the mismatch looks like an oversight otherwise.

### 2.14 Raj walks backwards — `renderer/animations.js` (a real bug, fixed)

Not a macOS issue, but found immediately on first launch and fixed because it is
the first thing anyone sees.

The renderer mirrors each sprite by comparing travel direction against the art's
own declared facing (`renderer/chotu.js:91-92`):

```js
const nativeSign = getCharacter(characterKey).nativeFacing === 'right' ? 1 : -1;
palEl.style.transform = `scaleX(${facing === nativeSign ? 1 : -1})`;
```

`raj` declared `nativeFacing: 'left'`, but **Raj's art faces right** — sunglasses
and nose on the right, back of the head on the left. Because the comparison is
symmetrical, a wrong declaration inverts the sprite in *both* directions, so Raj
walked backwards constantly rather than only one way.

```diff
- nativeFacing: 'left',
+ nativeFacing: 'right',
```

All five characters' sheets were inspected to avoid trading one wrong
declaration for another. **Only `raj` was wrong:**

| Character | Art faces | Declared | Verdict |
|---|---|---|---|
| raj | right | ~~left~~ → right | **was wrong, fixed** |
| hanu | left | left | correct |
| boy (Bud) | left | left | correct |
| girl (Pip) | left | left | correct |
| dog (Scout) | right | right | correct |

Note the preceding commit in this repo is titled *"Fix backwards walking"*. That
pass evidently corrected the four other characters and left the default one
inverted — which is why the bug survived: it looks like already-fixed territory.

### 2.15 White specks in Raj's hair — `tools/slice-sheet.js` (a real bug, fixed)

Also not a macOS issue. Reported from a screenshot of the running app: Raj's
black hair was stippled with white dots instead of being solid.

They were holes in the sprite's alpha channel. On a transparent, always-on-top
window there is nothing behind the character, so a transparent pixel inside the
silhouette shows the desktop straight through it — against a light desktop that
reads as a white speck.

**Root cause: the sprite slicer's background keying was eating the hair.**
`tools/slice-sheet.js` keys out the sheet's flat backdrop by colour distance:

```js
const BG = [23, 29, 38];   // a dark navy
const TOL = 40;            // Manhattan distance
```

Raj's hair is near-black, and several of its tones fall *inside* that tolerance
— `(19,21,22)` is distance 28, well under 40. The keying is guarded by a
border flood fill, which is what normally protects dark interior detail, but
that guard does not help here: the hair is the outermost part of the
silhouette, so the fill reaches it from the outside and hollows it out.
Roughly a third of the hair mass was being classified as background.
`closeAlpha()` then patched most of it back, which is why the shipped frames
looked *nearly* solid — the specks were the remnants the closing could not
reach.

Measured on the shipped assets: **27 of 31 Raj frames** contained enclosed
transparent regions, 684 pixels in total, clustered at `y = 2..7` — the hair.

**The fix** is a two-part backdrop test. The backdrop is a blue-dominant navy
(`b - r = +15`); Raj's hair is near-black but *neutral* (`b - r = 0..3`).
Distance alone cannot separate them, but the blue cast can:

```js
const TOL_CORE = 10;   // this close to BG, it is backdrop regardless
const BG_CAST  = 6;    // beyond that, require the backdrop's blue cast

function isBgColor(r, g, b) {
  const d = bgDiff(r, g, b);
  if (d <= TOL_CORE) return true;
  return d <= TOL && (b - r) >= BG_CAST;
}
```

The loose `TOL` has to stay for the antialiased rim where the backdrop blends
into the art — and that rim is part backdrop, so it carries the blue cast and
is still removed. Neutral dark art no longer is.

A second, smaller defect compounded it: `closeAlpha()` runs at source
resolution, but the frame is then downscaled ~3× with `kernel: 'nearest'`, and
nearest-neighbour resampling of a binary alpha mask can reopen gaps that
closing had already sealed. So `fillEnclosedHoles()` now runs *after* the
resize, filling transparent pixels unreachable from the frame edge by growing
colour inward from the rim. This is safe for Raj specifically because his sheet
has no intentional see-through space inside the silhouette — the genuine gaps
(under a raised arm, between his legs mid-stride) all open to the frame edge
and so are never reached.

Result, verified by re-scanning every frame:

| Keying | Components (must be 31) | Enclosed hole px |
|---|---|---|
| Shipped (`TOL` 40 only) | 31 | **684** |
| Naive tight (`TOL` 8) | **26 — fails the slicer's own assertion** | — |
| Two-part test | 31 | 75 |
| Two-part test + post-resize fill | 31 | **0** |

The naive-tight row is why the original loose tolerance existed and must not
simply be lowered: with `TOL = 8` enough backdrop survives between neighbouring
sprites that `findComponents()` merges them, and the slicer's
`expected exactly 31 components` guard correctly rejects the run.

Beyond removing the specks this visibly *improves* the art, because the hair
mass that the keying had been eating is now retained — Raj's hair is fuller and
rounder, matching the source sheet.

**The other four sheets** come from `tools/slice-character.js`, which was not
changed. They were scanned anyway and were far less affected (Bud 22px, Pip 2px,
Hanu 1px, Scout's cracks 43px), so they are repaired in place by
`tools/fix-alpha-speckles.js` instead of by re-slicing. That tool caps the
region area per sheet, because **Scout's art does contain intentional enclosed
transparency**: when a paw lands it closes off the wedge between the legs,
giving 15–82px pockets that must stay see-through. Filling those would web the
dog's legs together. Raj, Hanu, Bud and Pip have no intentional interior holes
at all, so their sheets are repaired in full.

That difference is a fact about the art, not something derivable from geometry —
narrow-vs-wide shape tests cannot tell a hair bay from a thin gap between a
dog's legs, and a morphological closing was measured to bridge Scout's leg gaps
in all 12 of his frames even at radius 1. Hence an explicit per-sheet table
rather than one clever heuristic.

### 2.16 What was deliberately *not* changed

**`electron-store` stays at `^8.2.0`.** Version 9 and later declare
`"type": "module"` and are ESM-only. `main.js` is CommonJS and uses
`require('electron-store')`, so upgrading would break the app at startup with
`ERR_REQUIRE_ESM`. Confirmed: the installed 8.2.0 has no `"type"` field.
This is a trap for anyone running a routine dependency bump — the version jump
looks harmless and is not.

---

## Part 3 — Verification log

Claims in this document were checked against on-disk sources or reproduced by
running code. This section records how, so the claims can be re-checked rather
than trusted.

### 3.1 Electron API platform annotations

Read from `node_modules/electron/electron.d.ts` in the installed Electron 44.3.0:

| API | Annotation | Consequence |
|---|---|---|
| `skipTaskbar` | `@platform darwin,win32` | **Works on macOS too.** |
| `setVisibleOnAllWorkspaces` | `@platform darwin,linux` | Valid on macOS. |
| `visibleOnFullScreen` | `@platform darwin` | Valid. |
| `skipTransformProcessType` | `@platform darwin` | Valid. |
| `movable` | `@platform darwin,win32` | Valid. |
| `hasShadow` | *(none)* | Cross-platform option. |
| `app.focus({ steal })` | `@platform darwin` | Valid; docs advise sparing use. |
| `app.dock` | `@platform darwin`, typed `Dock \| undefined` | Guard required. |

### 3.2 The shell helper's escaping

The focus helper is a shell script embedded in a JavaScript template literal, so
backslashes are escaped twice and a mistake would be invisible until runtime.
Rather than eyeball it, the literal was **extracted from `main.js` and executed**:

```
$ printf '\n\n\n' | /bin/sh -c "$(cat /tmp/focus_extracted.sh)" | cat -e
Terminal$
Terminal$
Terminal$
```

Three pings produced exactly three newline-terminated lines with the correct
front-application name, and exit status 0. This confirms the escaping survived
the literal, `lsappinfo` works without any permission grant, and the one-line-
per-ping contract that `focusPending` depends on holds.

### 3.3 Packaging actually works

`electron-builder` 24.13.3 is from 2023 and Electron 44 is far newer, so their
compatibility was treated as an open question and tested rather than assumed:

```
$ CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir
  • electron-builder  version=24.13.3 os=25.5.0
  • packaging       platform=darwin arch=arm64 electron=44.3.0
  • skipped macOS code signing  reason=identity explicitly is set to null
  exit 0
```

The resulting bundle was then inspected rather than assumed correct:

- `LSUIElement` = `1` — the accessory-app plist key was applied.
- `CFBundleIdentifier` = `com.rudrafuture.minime`, version `1.1.0`.
- `CFBundleIconFile` = `icon.icns`, and the file is present in `Contents/Resources`.
- `LSMinimumSystemVersion` = `13.0`.
- `app.asar` built, 2,227 entries.
- **All eight assets `checkRequiredAssets()` requires on macOS are inside the
  asar**, including `assets/tray-mac.png` — so the new `files` globs did not miss
  them and a packaged launch will not abort. All eleven `renderer/` files present.

### 3.4 A suspected bug that turned out not to be real

Settings inputs are read with `Number(document.getElementById(f).value)`, which
suggested that clearing a field would store `NaN` and corrupt the config.

**This was investigated and is not a bug.** `Number('') === 0`, and all seven
numeric fields are floored by `CONFIG_MIN` in the main process, so `NaN` is
unreachable and a cleared field resolves to the minimum. Reported as sound
rather than written up as a finding.

---

## Part 4 — Corrections

Three claims made earlier in this work were wrong and are corrected here so the
record is not misleading.

1. **`skipTaskbar` is not Windows-only.** It was described that way; the
   typings annotate it `@platform darwin,win32`. It works on macOS.

2. **An endpoint security agent was identified as the cause of the Electron
   block. That was wrong.** It was reached by elimination while the actual
   mechanism — XProtect enforcing a revoked notarization — had not been
   considered. The "Malware Blocked" dialog text is the direct evidence, and the
   controls in [Part 1.3](#13-what-was-ruled-out-and-how) contradict the EDR
   theory. Elimination arguments are only as good as the hypothesis list, and
   that list was incomplete.

3. **The hair specks were first attributed to the nearest-neighbour downscale.
   That was a secondary cause, not the primary one.** The initial diagnosis was
   that `closeAlpha()` runs before the ~3× `kernel: 'nearest'` resize and that
   the resize reopens sealed gaps. That mechanism is real and does account for
   75 of the 684 hole pixels, which is why `fillEnclosedHoles()` was added after
   the resize. But it is not what caused the bug. The primary cause is the
   backdrop keying matching Raj's near-black hair — visible only by rendering
   the *source-resolution* mask, which showed roughly a third of the hair mass
   being classified as background before any resizing happened. The lesson is
   the same as correction 2: the first plausible mechanism was accepted without
   inspecting the earliest stage of the pipeline. Full detail in
   [2.15](#215-white-specks-in-rajs-hair--toolsslice-sheetjs-a-real-bug-fixed).

A fourth correction, of severity rather than fact, is in Part 5 issue 3.

---

## Part 5 — Known issues (not fixed)

These are **pre-existing and platform-independent** — they affect Windows
exactly as much as macOS and are not consequences of the port. They were left
unfixed by choice, to keep the port reviewable as a port. Each was reproduced by
executing the real modules; `state.js` and `timers.js` are pure and import no
Electron APIs, so they run under plain Node.

### Issue 1 — Saving Settings silently restarts paused reminders

**Severity: user-visible, easy to hit.**

`renderer/settings.js:55` sends *all* numeric fields on every save:

```js
for (const f of fields) patch[f] = Number(document.getElementById(f).value);
```

so the guard in `main.js:887` is always true, and `timers.setIntervals()` always
runs. `timers.js:74-75` then calls `.start()` unconditionally:

```js
setIntervals({ stretchIntervalMin, waterIntervalMin }) {
  if (typeof stretchIntervalMin === 'number') this.stretch.reset(...);
  if (typeof waterIntervalMin === 'number') this.water.reset(...);
  this.stretch.start();   // <-- unconditional
  this.water.start();
}
```

Reminders are paused during a focus session (`main.js:469`) and during sleep
(`main.js:947`). Opening Settings and pressing Save in either state resumes
them.

**Effect:** a stretch or water reminder interrupts you mid-focus-session, or
wakes the pet during quiet hours.

**Reproduced:**

```
after start()      : stretch.running = true  | water.running = true
after pauseAll()   : stretch.running = false | water.running = false
after setIntervals : stretch.running = true  | water.running = true
```

**Suggested fix:** have `setIntervals` preserve each timer's prior `running`
state instead of starting unconditionally, or pass the desired state in from the
caller, which knows whether a focus session or sleep is active.

### Issue 2 — Reminders are silently dropped in several states

**Severity: user-visible, silent.**

`state.js:326 requestReminder()` only queues a rejected reminder when the state
is `DRAGGED`. The `!interruptible` early return fires **before** the queueing
branch is reached, so every other non-interruptible state drops the reminder
with no record:

```js
if (this.state === STATES.DRAGGED) { /* queues */ return false; }
const interruptible = IDLE || WALKING || FOLLOWING || RESTING || PLAYING;
if (!interruptible) return false;          // <-- drops it, queues nothing
if (this._pendingReminder && ...) { /* queues */ }
```

`PausableTimer._fire()` ignores the return value — `onFire(); reset(); start();`
— so the interval is rearmed regardless. The reminder is not deferred, it is
lost, and the user waits another full interval.

**Reproduced** (driving the real state machine):

```
state        | requestReminder | queued?
-------------|-----------------|--------
IDLE         | true            | none
GOING_HOME   | false           | none     <-- lost
REMINDING    | false           | none     <-- lost
DRAGGED      | false           | water    <-- correctly queued (control)
```

Reachable cases with timers running: `REMINDING` (one reminder on screen when
the other fires), `GOING_HOME`, `ENTERING_HOUSE`, `WAKING`, `EXITING_HOUSE` —
e.g. the quiet-hours walk home. `SLEEPING`, `WORKING` and `BREAK` are
unreachable in practice because timers are paused in those states.

The queueing mechanism already exists and works, as the `DRAGGED` control shows;
it simply is not applied to these states.

**Suggested fix:** move the `_queuedReminder` assignment into the
`!interruptible` path so any rejected reminder is queued and drained on return
to an interruptible state.

### Issue 3 — `conf` re-reads config.json from disk on every `get()`

**Severity: negligible. This was measured, and the measurement contradicts the
initial assessment.**

`conf@10.2.0`'s `get store()` performs a full `fs.readFileSync` + deserialize +
validate on **every** property access (`node_modules/conf/dist/source/index.js:276`),
and `get(key)` goes through it.

The 16 ms tick loop reads two keys per tick — `store.get('followCursor')`
(`main.js:786`) and `housePosition()` → `store.get('housePos')`
(`main.js:184`). At `TICK_MS = 16` that is **125 synchronous disk reads per
second** in steady state.

The count is real, but the cost is not meaningful. Measured on this machine,
with `history` at its hard ceiling of 500 entries (`main.js:145`):

| `history` entries | config.json | per read | cost at 125 reads/s |
|---|---|---|---|
| 0 | 487 B | 0.012 ms | 1.5 ms/s (0.15% of a core) |
| 100 | 10 KB | 0.022 ms | 2.8 ms/s (0.28% of a core) |
| 500 (max) | 49 KB | 0.067 ms | 8.4 ms/s (0.84% of a core) |

The file stays in the page cache, and `history` is bounded, so the worst case is
bounded too. **This was initially framed as a performance problem; that framing
was overstated and is withdrawn.** It is a tidiness issue, not a bug. Caching
the two hot keys in memory would be a reasonable cleanup, not a fix.

There is genuine irony worth noting for a future reader: the file carries two
careful comments about avoiding synchronous *writes* in the tick loop
(`main.js:176-179`, `main.js:802-803`) while the *reads* are equally synchronous
and unthrottled. The author's instinct was right; it was just applied to only
half the problem.

### Issue 4 — `PausableTimer.fireNow()` is dead code and broken

**Severity: none today; a trap for the next contributor.**

`timers.js:35`:

```js
fireNow() {
  this.pause();
  this.onFire();
  this.reset();     // resets, but never start()s
}
```

Compare `_fire()`, which correctly ends with `this.start()`. Any future caller of
`fireNow()` would fire the reminder once and then permanently stop that timer.

**Reproduced:**

```
after start()   : running = true  remaining = 1000
after fireNow() : running = false remaining = 1000 | onFire calls = 1
```

**Suggested fix:** add `this.start()`, or delete the method. It has no callers.

### Issue 5 — Minor: empty `quietHours` times compare as strings

`<input type="time">` yields `''` when empty, and the quiet-hours check
compares time strings directly. An empty start or end produces a comparison
against `''` rather than being treated as unset. Low impact, noted for
completeness.

---

## Part 6 — Untested and residual risk

Stated plainly so nothing here reads as more verified than it is.

1. **The app has been launched and runs; some behaviours are still unobserved.**
   Confirmed on screen and by inspection: the app starts with no errors, runs as
   four stable processes, passes `checkRequiredAssets()`, writes its config, and
   Launch Services reports it as `type="UIElement"` — empirical proof that
   `app.dock.hide()` worked and no Dock icon appears. The tick loop and state
   machine advance (`lastState` observed moving `IDLE → WALKING → IDLE`), and the
   pet renders and animates.

   Still unobserved: the water overlay (it needs a 45-minute wait to fire
   naturally, though the tray's "Drink now" forces it), Spaces and fullscreen
   behaviour, the Settings window raising itself, and the menu bar icon's
   rendered size next to system items.

2. **`dmg` and `zip` targets were not built.** Only `--dir` was, which is what
   validates the electron-builder/Electron-44 pairing. The installer targets
   involve additional machinery (DMG creation, `notarize`) that was not
   exercised.

3. **The build is not distributable as configured.** `identity: null` means the
   packaged app inherits Electron's **ad-hoc** signature
   (`Signature=adhoc`, `TeamIdentifier=not set`, verified above). It runs on the
   machine that built it; on anyone else's Mac, Gatekeeper will block it. Real
   distribution requires a Developer ID Application certificate, hardened
   runtime, and notarization. Given that this project was blocked for a day by
   *Apple's* notarization revocation, the irony is worth stating: shipping this
   to others means entering that same system as a participant.

4. **Only tested on Apple Silicon.** No Intel (`x64`) or universal build was
   produced or run. No `mas` (App Store) target was attempted; `LSUIElement`
   accessory apps have additional App Store review considerations.

5. **`MOOD_BY_APP_MAC` keys are unverified beyond a handful.** `Terminal` was
   confirmed end to end. The rest are the correct display names to the best of
   available knowledge, but each app's exact `LSDisplayName` was not checked
   individually. A wrong key fails silently — the pose simply never plays. Easy
   to audit: run the Part 3.2 command, switch apps, and compare the printed
   names against the table.

6. **Multi-display and display-change behaviour is unexercised on macOS.** The
   overlay sizes to `screen.getPrimaryDisplay().bounds` at creation time, so it
   covers only the primary display, and a resolution change while the overlay is
   open is not handled. `housePosition()` clamps to the work area, which limits
   the blast radius for the pet itself.

7. **One unexplained observation: a reminder appeared to fire ~28 seconds after
   launch.** While monitoring `lastState` on the first run, the state was seen to
   reach `REMINDING`, with the configured intervals at 45 and 60 **minutes**.

   What was ruled out: `lastState` is write-only (`main.js:806`) and never
   restored, so it was not stale persisted state; `_pendingReminder` is assigned
   in exactly one place (`state.js:341`, inside `requestReminder()`), so the
   state machine genuinely entered a reminder; and the tray menu — the only other
   caller — was not touched. `Number`-to-`NaN` was also excluded (see
   [3.4](#34-a-suspected-bug-that-turned-out-not-to-be-real)); the intervals
   resolve to 2,700,000 ms and 3,600,000 ms, both well under the 32-bit
   `setTimeout` limit that would cause an immediate fire.

   It did **not** recur across 90 seconds of continuous monitoring on the
   following run. This is recorded as an open question rather than a diagnosed
   bug: it may be a real early-fire path, or a misattributed sample. Anyone
   picking this up should watch for an unprompted reminder in the first minute
   after launch. If it reproduces, `ReminderTimers`' construction in
   `main.js:958-963` is the place to start.

8. **The macOS focus helper depends on `lsappinfo` output format.** It is an
   undocumented Apple tool, and the `sed` pattern matches `"LSDisplayName"="…"`.
   A future macOS could change that format, which would silently disable the
   cosmetic feature — it would not break the app, because the helper still
   prints an empty line per ping.

---

## Appendix A — Reproducing the verification

Node is via nvm and is not on a non-interactive `PATH`; prefix accordingly.

```sh
export PATH="$HOME/.nvm/versions/node/<version>/bin:$PATH"
cd /path/to/MiniMe
```

**Install (behind a TLS-inspecting proxy):**

```sh
NODE_OPTIONS=--use-system-ca npm install
```

If Electron's postinstall is skipped by npm's install-script gating, `dist/` will
be missing; run it manually:

```sh
(cd node_modules/electron && node install.js)
```

**Confirm Electron executes:**

```sh
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  -e 'console.log(process.versions.electron, process.versions.chrome)'
```

**Reproduce Issues 1 and 4:**

```sh
node -e '
const { ReminderTimers, PausableTimer } = require("./timers.js");
const t = new ReminderTimers({ stretchIntervalMin: 45, waterIntervalMin: 60,
  onStretch(){}, onWater(){} });
t.start(); t.pauseAll();
t.setIntervals({ stretchIntervalMin: 45, waterIntervalMin: 60 });
console.log("Issue 1 - restarted while paused:", t.stretch.running && t.water.running);
t.pauseAll();
const p = new PausableTimer(1000, () => {});
p.start(); p.fireNow();
console.log("Issue 4 - dead after fireNow:", p.running === false);
process.exit(0);'
```

**Reproduce Issue 2:**

```sh
node -e '
const { PalState } = require("./state.js");
const mk = () => new PalState({ bounds:{minX:0,maxX:1000,minY:0,maxY:600},
  houseDoor:{x:900,y:0}, startX:10, startY:10 });
const a = mk(); a.requestSleep();
console.log("GOING_HOME:", a.requestReminder("water"), "queued:", a._queuedReminder);
const b = mk(); b.requestReminder("water");
let n = 0; while (b.state !== "REMINDING" && n < 20000) { b.tick(16); n++; }
console.log("REMINDING :", b.requestReminder("stretch"), "queued:", b._queuedReminder);
process.exit(0);'
```

Both should print `false` with `queued: null` — the reminder is dropped.

**Inspect the focus helper as it actually runs:**

```sh
node -e '
const fs = require("fs");
const m = fs.readFileSync("main.js","utf8").match(/const FOCUS_SH = `([\s\S]*?)`;/);
fs.writeFileSync("/tmp/focus.sh", eval("`" + m[1] + "`"));'
printf '\n\n\n' | /bin/sh -c "$(cat /tmp/focus.sh)" | cat -e
```

**Package and inspect:**

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir
defaults read "$PWD/dist/mac-arm64/MiniMe.app/Contents/Info.plist" LSUIElement   # -> 1
npx asar list dist/mac-arm64/MiniMe.app/Contents/Resources/app.asar | grep tray-mac
```

**Confirm no sprite has transparent holes (2.15):**

```sh
node tools/inspect-holes.js assets/pal assets/dog assets/boy assets/girl assets/hanu
```

Expect exactly **8 enclosed regions, 307px total, all in `assets/dog/`** — those
are Scout's intentional leg gaps. Any region in `assets/pal/` is a regression.
To see it rather than count it, magnify onto a backdrop that cannot occur in the
palettes, so any pink is a hole:

```sh
node tools/preview-frames.js /tmp/pal.png 8 assets/pal/stand_01.png assets/pal/walk_0*.png
```

**Re-derive the keying comparison table (2.15):**

```sh
node tools/keying-experiment.js /tmp/k/current current 10 40 6   # -> filtered=31
node tools/keying-experiment.js /tmp/k/tight   tight   8  40 6   # -> filtered=26, fails assertion
node tools/keying-experiment.js /tmp/k/cast    cast    10 40 6   # -> filtered=31
node tools/inspect-holes.js /tmp/k/current | tail -2              # -> 60 regions, 684px
node tools/inspect-holes.js /tmp/k/cast    | tail -2              # ->  6 regions,  75px
```

`current` reproduces the shipped assets exactly (684px), which is what
establishes the harness is faithful before the other rows are trusted.

---

## Appendix B — Files changed

```
 main.js                | 138 +++++++++++++++++++++++++++++++++++++++++++------
 tools/slice-sheet.js   | 113 +++++++++++++++++++++++++++++++++++++++-
 package.json           |  24 +++++++--
 renderer/animations.js |   4 +-
 renderer/settings.html |   4 +-
 5 files changed, 260 insertions(+), 23 deletions(-)
```

Regenerated / repaired binary assets — 42 files, no code change implied:

```
 assets/pal/*.png            31 frames, re-sliced with the corrected keying
 assets/pal/manifest.json    re-emitted by the slicer (bounding boxes unchanged)
 assets/dog/*.png             6 frames, cracks filled in place
 assets/boy/*.png             2 frames
 assets/hanu/*.png            1 frame
 assets/girl/*.png            1 frame
```

New files:

```
 START-MINIME.command          double-clickable macOS launcher
 assets/tray-mac.png           16x16 menu bar icon
 assets/tray-mac@2x.png        32x32 Retina menu bar icon
 assets/icon.icns              app / DMG icon
 MACOS-PORT.md                 this document
 tools/fix-alpha-speckles.js   repairs enclosed alpha holes in place (2.15)
 tools/inspect-holes.js        diagnostic: lists every enclosed hole with geometry
 tools/preview-frames.js       diagnostic: magnifies frames over magenta
 tools/keying-experiment.js    diagnostic: compares keying rules off to one side
```

The three diagnostics are not part of the build — `package.json` excludes
`tools/**` from packaging. They are kept because the measurements in
[2.15](#215-white-specks-in-rajs-hair--toolsslice-sheetjs-a-real-bug-fixed) are
otherwise unreproducible; `keying-experiment.js` in particular is what produced
the comparison table, including the finding that a naive tight tolerance breaks
the slicer.

`package-lock.json` also changed, from the Electron version bump.

Not modified: `state.js`, `timers.js`, `preload.js`, `renderer/chotu.js`,
`renderer/overlay.js`, `renderer/settings.js`, `tools/slice-character.js`,
`tools/slice-house.js`, and the reference sheets in `assets/reference/`.

Two changes are **not** macOS specific and not behind `IS_MAC`:
`renderer/animations.js` (the Raj facing fix,
[2.14](#214-raj-walks-backwards--rendereranimationsjs-a-real-bug-fixed)) and
`tools/slice-sheet.js` plus the regenerated assets (the hair-speck fix,
[2.15](#215-white-specks-in-rajs-hair--toolsslice-sheetjs-a-real-bug-fixed)).
Both correct the same defects on Windows.
