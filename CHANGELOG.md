# Changelog

All notable changes to MiniMe. Dates and entries are taken from the repository's own
commit history, not from memory.

## [1.2.0] — unreleased

Twelve commits since `v1.1.0`: five already on `main` and never tagged, plus seven on the
`fix/per-frame-facing` branch.

### Added

- **macOS support.** `IS_MAC` branches through `main.js`, a `dock.js` module for the Dock
  and menu-bar behaviour, `assets/icon.icns`, retina menu-bar icons
  (`assets/tray-mac.png`, `assets/tray-mac@2x.png`), and a double-clickable
  `START-MINIME.command` launcher that finds a Homebrew or nvm Node before giving up.
- **Four selectable characters** beyond Raj: Hanu, Boy, Girl and Dog.
- **Fetch.** Throw the bone and the dog runs for it, picks it up, carries it back and
  holds it. The bone is a real draggable object with its own position, and he teases you
  with it about one throw in five. `FETCH_RUN`, `FETCH_PICKUP`, `FETCH_CARRY` and
  `FETCH_HOLD` in `state.js`; poses in `renderer/animations.js`.
- **A test suite.** Four headless harnesses in `test/`, 298 assertions, no Electron
  required: `ladder-sim.js` (30), `play-sim.js` (29), `facing-sim.js` (205),
  `fetch-sim.js` (34). Run with `npm test`.
- **Sprite tooling** in `tools/`: frame-facing verification, alpha despeckling,
  defringing, sheet assembly and offscreen frame previews.
- **A macOS build job** in `.github/workflows/release.yml`, producing an unsigned `.dmg`
  and `.zip` for both Apple Silicon and Intel.

### Fixed

- **Characters no longer turn round on every step.** Facing is now decided once per
  character rather than per frame, and the facing table is checked against the actual
  sprite pixels instead of against itself — 63 frame pairs verified, 0 facing the wrong
  way (`npm run verify:facing`).
- **Backwards walking.**
- **The dog's paws vanishing** during the run cycle.
- **A white outline** around the characters drawn from white-background sheets.

### Changed

- The README was rewritten as a visual landing page, then tightened for scannability.

### Removed

- `docs/design-swarms/*.jsonl` — raw transcripts from the design sessions. They carried
  absolute machine paths and internal run identifiers, so they are kept locally and
  excluded from the repository.

## [1.1.0] — 2026-09-02

- Free-roam movement, focus sessions, real house art and drag support.
- The character was renamed from Pet to Chotu; one-click start added; shutdown IPC
  hardened.
- Repository URLs pointed at `RudraMind/MiniMe` after the rename.
- Release asset: `MiniMe-Setup-1.1.0.exe`.

## [1.0.0] — 2026-08-26

- First public release: the MiniMe desktop companion for Windows.
- Release workflow fixed to disable electron-builder's auto-publish, so the GitHub
  Release step owns asset upload.
- Release asset: `MiniMe-Setup-1.0.0.exe`.

[1.2.0]: https://github.com/RudraMind/MiniMe/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/RudraMind/MiniMe/releases/tag/v1.1.0
[1.0.0]: https://github.com/RudraMind/MiniMe/releases/tag/v1.0.0
