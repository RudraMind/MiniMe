# MiniMe

A pixel-art desktop companion for Windows. MiniMe walks along the edge of your
screen, wanders around on its own, and nudges you to stretch and drink water.
Right-click its house to send it to bed.

> Windows only. See [Platform support](#platform-support).

---

## Features

- **Roams your whole desktop** — wanders anywhere on screen, above your
  windows, without stealing clicks from anything underneath.
- **Focus sessions (body doubling)** — start one and they sit down and work
  beside you for 25 minutes with all reminders paused, then stand up and
  stretch with you at the break, repeating until you stop. Drag them anywhere
  while working to move their spot.
- **Follow your cursor** — optional: they walk slowly toward your pointer and
  sit down to relax when it stops moving.
- **React to your apps** — optional: they strike a pose suited to whatever app
  you switch to. Reads only the app's *name* — never window titles, page names,
  or filenames — and nothing leaves your computer.
- **Stretch reminders** — every 60 minutes (configurable) they walk to the
  center and hold up a speech bubble. A nudge only; it never blocks you.
- **Water reminders** — every 45 minutes (configurable) a full-screen pause
  appears with a 10-second countdown. Esc or **Skip** dismisses it instantly,
  and it closes itself if you Alt-Tab away. It never blocks Ctrl+Alt+Del,
  Alt+Tab, or Task Manager.
- **A house you can put anywhere** — drag it wherever you like; the spot is
  remembered. Right-click it to send them to bed, which pauses reminders.
- **Drag them around** — pick them up and drop them anywhere; they hold that
  spot for a few seconds before carrying on.
- **Give them a name** — used throughout the menus. Defaults to `Raj`.
- **Outfit colors** — pick a shirt and pants color (red, blue, yellow, black,
  green, orange, or the original art) from Settings.
- **Quiet hours** — optional auto-sleep overnight (off by default).
- **Idle personality** — between walks they dance, check their phone, cross
  their arms, give a thumbs up, and so on.

---

## Install

### Option 1 — Download the installer (easiest)

1. Go to [Releases](https://github.com/RudraMind/Mini-Assistant/releases).
2. Download `MiniMe-Setup-<version>.exe`.
3. Run it and follow the prompts.

MiniMe installs per-user, so **no administrator rights are needed**.

> **SmartScreen warning:** the installer is not code-signed, so Windows will
> show a "Windows protected your PC" screen. Click **More info → Run anyway**.
> This is expected for unsigned open-source apps. If you'd rather not, build it
> yourself from source with the steps below — the result is identical.

### Option 2 — Run from source

Requires [Node.js](https://nodejs.org/) 18 or newer.

```bash
git clone https://github.com/RudraMind/Mini-Assistant.git
cd Mini-Assistant
npm install
npm start
```

That's it — all sprite art ships in the repo already, so there's no asset
build step and no native image toolchain required just to run it.

---

## Using it

MiniMe appears on the top edge of your primary monitor and starts wandering.

| Action | How |
|---|---|
| Open settings | Right-click them or the house → **Settings…**, or use the tray icon |
| Wave | Left-click them |
| Move them | Drag them anywhere |
| Move the house | Drag the house anywhere |
| Start / stop a focus session | Right-click them, or the tray icon |
| Send to bed | Right-click the house → **Go to sleep** |
| Wake up | Right-click the house → **Wake up** |
| Trigger a reminder now | Tray icon → **Drink now** / **Stretch now** |
| Restart the app | Tray icon or right-click → **Restart** |
| Hide them | Tray icon → **Hide** |
| Quit | Tray icon → **Quit** |

Closing windows does **not** quit MiniMe — it lives in the system tray. Use
**Quit** from the tray menu.

### Settings

Everything is configurable from the Settings window and persists across
restarts: their name, focus session and break lengths, reminder intervals,
water overlay length, speech bubble duration, walk speed, shirt and pants
color, cursor-following, app-based moods, quiet hours, and whether MiniMe
starts with Windows.

Settings are stored in `%APPDATA%\mini-me\config.json`.

---

## Building the installer yourself

```bash
npm install
npm run dist      # creates dist/MiniMe-Setup-<version>.exe
npm run pack      # unpacked build only, for quick testing
```

> **Windows gotcha:** `electron-builder` downloads a signing toolchain that
> contains macOS symlinks, and Windows refuses to create symlinks without
> elevated rights. If the build fails with
> `Cannot create symbolic link ... libcrypto.dylib`, enable
> **Settings → System → For developers → Developer Mode**, then rebuild. (This
> is an `electron-builder` packaging quirk, not a MiniMe bug — it does not
> affect running the app.)

Releases are also built automatically by GitHub Actions on any `v*` tag — see
[`.github/workflows/release.yml`](.github/workflows/release.yml).

---

## Regenerating art

Sprite frames are committed to the repo, so you only need this if you replace
the source sheet at `assets/reference/spritesheet.png`.

```bash
npm install sharp to-ico   # optional deps, only needed for this step
npm run assets             # re-slices sprites + regenerates icons
node tools/slice-house.js  # re-slices the 3 house states
```

The slicer cuts 31 poses out of the sheet by connected-component detection. If
it finds anything other than exactly 31 figures it stops and reports the count
rather than guessing — see [`BUILD_LOG.md`](BUILD_LOG.md) for how the masking
works and why.

---

## Platform support

**Windows only.** MiniMe relies on Windows behavior for transparent,
always-on-top, click-through windows and for the full-screen water overlay.
There is no macOS or Linux build, and mobile is out of scope by design (no
desktop surface to walk on).

The app runs on the primary display only; multi-monitor setups are not
supported, but MiniMe will not crash on them.

---

## Project layout

```
main.js            app lifecycle, windows, tray, timers, screen geometry
state.js           pal state machine — pure logic, no Electron imports
timers.js          pausable stretch/water schedulers
preload.js         contextBridge IPC surface
renderer/          pet, overlay, and settings UIs (plain HTML/CSS/JS)
tools/             sprite/house slicers + icon generator (optional, dev only)
assets/pal/        the 31 generated sprite frames
assets/house/      the 3 generated house states
BUILD_LOG.md       build notes, corner cases, and troubleshooting history
```

`state.js` deliberately has no Electron dependency, so pal behavior can be
tested from plain Node without launching the app:

```bash
node -e "const {PalState}=require('./state.js'); /* ... */"
```

## Contributing

Issues and pull requests are welcome. If you're reporting a bug about MiniMe
being in the wrong place, `main.js` (screen geometry) and `state.js` (position
logic) are the files to name; for wrong sprites, jitter, or wrong facing, it's
`renderer/pet.js` and `renderer/pet.css`.

## License

[MIT](LICENSE)
