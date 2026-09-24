# MiniMe — orientation for Claude Code

A pixel-art desktop companion (Electron). A little character walks your screen,
nudges you to stretch and drink water, runs focus sessions, and gets bored when
you ignore him. Originally Windows-only; ported to macOS in this repo.

Upstream `origin` is `https://github.com/RudraMind/MiniMe.git` — but see
**House rules** below before doing anything with it.

## Read these first

| Doc | For |
|---|---|
| **[docs/CHARACTERS.md](docs/CHARACTERS.md)** | The five characters (Raj, Hanu, Boy, Girl, Dog), every pose each one actually has, what happens when the code asks for art that doesn't exist, the recolour, the asset pipeline. |
| **[docs/BEHAVIOUR.md](docs/BEHAVIOUR.md)** | States, the chair, the boredom ladder, reminders, focus sessions, all tuning constants, geometry, how to test. |
| [docs/superpowers/specs/2026-09-10-boredom-ladder-design.md](docs/superpowers/specs/2026-09-10-boredom-ladder-design.md) | Why the boredom ladder is built the way it is, and what was verified. |
| [MACOS-PORT.md](MACOS-PORT.md) | The macOS port, change by change. **Part 5 is a list of known open bugs.** |
| [cosmetic-fix.md](cosmetic-fix.md) | The transparent-hole / white-speck art fix. Read before touching `tools/slice-*.js`. |
| [BUILD_LOG.md](BUILD_LOG.md) | Earlier build history, corner cases, packaging. §7 is the asset-rebuild checklist. |

## Running it

Node is installed via **nvm, which is not on the default PATH**. Every shell
command that runs `node` or `npm` needs this prefix, or you get
`node: command not found`:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; npm start
```

Node v24, Electron 44.3.0 (**not** downgradable — earlier versions are killed by
macOS as malware; `MACOS-PORT.md` §1.2). `npm start` = `electron .`. The app is a
menu-bar accessory with no Dock icon, so "is it running?" means checking the tray
icon or `pgrep -f "electron \."`.

Useful while developing:

```bash
npm test                                              # 298 assertions, ~2s, no Electron
MINIME_BOREDOM_SCALE=0.1 MINIME_DEBUG_LADDER=1 npm start
```

`npm test` runs the four behaviour harnesses in `test/` against `state.js`
directly — `ladder-sim` (30 assertions), `play-sim` (29), `facing-sim` (205),
`fetch-sim` (34). **Run it after any change to `state.js`** — it catches the things that
are otherwise invisible until someone sits still for 15 minutes.

The env vars run the boredom ladder 10× faster and trace every state change.
Without them the ladder takes 15 minutes of untouched keyboard to play out.

## Architecture in one paragraph

`main.js` (Electron main) owns windows, tray, menus, settings, screen geometry and
the 16ms tick. `state.js` is the entire state machine and is **pure** — no
Electron, no DOM, no filesystem — so all behaviour is testable headlessly.
`renderer/` only draws. `state.js` emits *semantic* pose names (`walk`, `doze`,
`inspect`); `renderer/animations.js` maps those onto whatever frames each
character actually owns. **Nothing outside `renderer/animations.js` knows a
filename.**

## Traps that have already caused real bugs

- **Facing.** `raj` and `dog` art faces right; `hanu`, `boy`, `girl` face left.
  Assume wrong and the character moonwalks. There is **no up/down art** for anyone.
- **`walkSpeed` is pixels per 16ms**, not per ms. Scaling by raw `dtMs` made the
  pal cover ~1400px/sec.
- **A pinned macOS Dock is *harder* to reach than a hidden one** — macOS removes a
  pinned Dock's strip from `workArea`, and the pal's window is sized to `workArea`.
- **Reminders must interrupt every new state.** A stretch nudge silently vanishing
  because the pal was off inspecting the Dock is worse than any missed charm. Check
  `requestReminder()`'s interruptible list whenever you add a state.
- **Re-running the sprite slicers naively reintroduces white specks** in Raj's hair
  and shirt. Read `cosmetic-fix.md` first.
- **`build.files` in `package.json` is an allowlist.** A new top-level `.js` file
  must be added by hand or it is simply absent from the built app and it crashes
  at launch — which never shows up running from source. This has now bitten twice
  (the tray icon, then `dock.js`).
- **Test by waiting for a state, not by sleeping for a duration.** Every false
  test failure while building the ladder was this mistake.

## House rules for this project

- **The repo is public** at https://github.com/RudraMind/MiniMe. File findings as docs
  inside this folder, and land work by following the runbook in `GIT-COMMANDS.md`. Do
  **not** push, tag or release anything unless the owner asks for it.
- **`MACOS-PORT.md` Part 5, Issues 1–5 are report-only.** Those reminder/config
  bugs were deliberately left unfixed. Do not fix them without asking first.
- **The working tree is clean.** Everything — the macOS port, the cosmetic fixes, the
  boredom ladder, the dog fetch feature — is committed, and the branch
  `fix/per-frame-facing` sits 7 commits ahead of `origin/main`. Commit only when asked.
- **Windows must not regress.** This is a cross-platform app being developed on a
  Mac. Platform branches are kept inline next to the Windows behaviour they diverge
  from, on purpose.
- Plain, concrete language in replies. No `file.js:123` citations, no
  architecture/cost abstractions — describe what the user would see happen.

Last updated 2026-09-23.
