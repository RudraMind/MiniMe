# GIT-COMMANDS.md — publishing runbook for MiniMe

**Read this file top to bottom before running anything.** It is self-contained: every check
it asks for is written out here with its expected value, so nothing outside this folder is
needed.

**Which case this was written for.** MiniMe is **already published**. The remote
`https://github.com/RudraMind/MiniMe.git` has 20 commits, `main`, and the tags `v1.0.0` and
`v1.1.0`, each with a Windows installer attached as a release asset. So this is a **push and
release**, not a first publish.

- **Do not run `git init`.** There is a real `.git` directory in this folder with the full
  history.
- **Never run `git push --force`.** Not to fix a mistake, not to save time. Nothing here
  requires it.

Prepared 2026-09-23. Verified against this folder on that date.

## What is in this folder

| | |
|---|---|
| What gets pushed | **190 files, 14.3 MiB** |
| On disk | **44 MB** — 16 MB `.git`, 13 MB tracked `assets/`, 13 MB `_ART-REFERENCE/` |
| Runbook | this file |

`_ART-REFERENCE/` is a browsable spare copy of all 96 character sprites plus the eight master
source sheets, carried so the art travels visibly with the handoff. **It is gitignored on
purpose and must not be committed** — the real art is already tracked under `assets/`, and
committing the duplicate would double the repository for no gain. Verified 2026-09-23: 96 files
compared against `assets/`, 0 mismatches, and `git add -An` does not pick the folder up. See
`_ART-REFERENCE/README.md`.

## Where this folder stands

Twenty-seven publish-readiness checks were run against this folder, each one that passes by
finding nothing paired with a positive control:

```
NOT READY — unverified: E1, E2
23 passed · 1 n/a (no symlinks) · 0 failed · 2 unverified
```

**Both unverified checks are owner inputs, not defects.** E1 is the git identity, which is
deliberately left unset so that it is set from the owner's own answer in section 5. E2 is how
the work should land — pull request, local merge, or branch only — which is the owner's
decision and is asked for in section 0. Once those two answers exist, nothing else is
outstanding.

Everything else has been done and measured: the privacy problem is fixed and re-swept, the
documentation no longer contradicts the code, the version is bumped, a macOS build job exists,
and `npm test` passes 298 assertions with zero failures in this folder with no `node_modules`
installed.

---

## 0. Values the owner must supply

Ask for each of these before running anything. **Do not guess any of them, and do not read
them out of a config file on the machine.**

| Slot | What it is | Notes |
|---|---|---|
| `GITHUB_USERNAME` | the GitHub account that will push | The repo lives under the `RudraMind` account. This is the login name, which may differ. |
| `GITHUB_TOKEN` | a personal access token | **Not a password.** See section 1. Never paste it into a file in this folder. |
| `COMMIT_NAME` | name for the new commit | Every existing commit uses one identity. Read it, do not guess it: `git log -1 --format='%an'`. Matching it keeps the history consistent. |
| `COMMIT_EMAIL` | email for the new commit | Same: `git log -1 --format='%ae'`. Confirm with the owner before reusing it. |
| `LANDING` | how the work lands | One of: `pr` (open a pull request), `merge` (fast-forward `main` locally and push it), `branch` (push the branch only and decide later). **The owner's choice, not yours.** |
| `DO_RELEASE` | whether to cut v1.2.0 | `yes` tags `v1.2.0` and lets CI build installers. `no` stops after the push. |

If the owner does not answer a slot, **stop and ask.** Do not substitute a default.

---

## 1. Authentication — a password will not work

Verified against GitHub's own documentation, 2026-09-23:

> "starting on August 13, 2021, at 09:00 PST, we will no longer accept account passwords
> when authenticating Git operations on GitHub.com"
> — <https://github.blog/changelog/2021-08-13-git-password-authentication-is-shutting-down/>

> "Git will ask for your GitHub username and password. When Git prompts you for your
> password, enter your personal access token."
> — <https://docs.github.com/en/get-started/git-basics/about-remote-repositories>

So at the prompt: **username = the GitHub login, password field = the token.**

### Which token permissions

**Fine-grained token** — repository permissions on `RudraMind/MiniMe`:

| Permission | Level | Needed for |
|---|---|---|
| Contents | Read and write | pushing commits, creating the release, uploading release assets |
| Pull requests | Read and write | only if `LANDING` is `pr` |
| Workflows | Read and write | **required here** — see the trap below |

**Classic token** — scopes:

| Scope | Needed for |
|---|---|
| `public_repo` | pushing, the PR, the release (MiniMe is a public repo) |
| `workflow` | **required here** — see the trap below |

### The trap that will otherwise reject the push

This push modifies `.github/workflows/release.yml` (a macOS build job was added). GitHub's
scope documentation is explicit:

> `workflow`: "Grants the ability to add and update GitHub Actions workflow files. Workflow
> files can be committed without this scope if the same file (with both the same path and
> contents) exists on another branch in the same repository."
> — <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>

The file's contents are **not** identical to any branch on the remote, so **without
`workflow` scope the push is rejected.** If the push fails with a workflow-scope error, that
is why — the fix is a new token, not a force push.

### A second trap, for the release

> "events triggered by the `GITHUB_TOKEN` will not create a new workflow run"
> — <https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow>

The `v1.2.0` tag must therefore be pushed **by a human or a personal access token**, never by
a workflow. Following this runbook by hand satisfies that.

### Never commit the token

> "When push protection detects a potential secret during a push attempt, it will block the
> push and provide a detailed message explaining the reason for the block."
> — <https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection>

Type the token at the prompt. Do not write it into any file in this folder.

### Optional: stop retyping it

GitHub documents **Git Credential Manager**, not `osxkeychain`:

> "For macOS, you don't need to run `git config` because GCM automatically configures Git
> for you."
> — <https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git>

Skip this if the token will only be used once.

---

## 2. Confirm you are in the right folder and the state is what this runbook expects

Run all of it. **If any line disagrees with the expected value, stop and report — do not
continue.**

```sh
cd <this folder>

git rev-parse --is-inside-work-tree     # expect: true
git rev-list --count HEAD               # expect: 20
git remote -v                           # expect: origin  https://github.com/RudraMind/MiniMe.git (fetch and push)
git branch --show-current               # expect: fix/per-frame-facing
git rev-list --count origin/main..HEAD  # expect: 7
git rev-list --count HEAD..origin/main  # expect: 0   (nothing to reconcile, clean fast-forward)
git tag                                 # expect: v1.0.0  v1.1.0  (and no v1.2.0 yet)
git branch --list 'backup/*'            # expect: backup/pre-scrub-2026-09-23
git status --porcelain | wc -l          # expect: 13   (11 modified + 2 new files, see section 3)
```

Confirm the remote is reachable and unchanged since this runbook was written:

```sh
GIT_TERMINAL_PROMPT=0 git ls-remote --heads --tags origin
# expect refs/heads/main, refs/tags/v1.0.0, refs/tags/v1.1.0 and nothing else.
# If a new branch or tag has appeared, the owner pushed something since 2026-09-23. Stop and ask.
```

---

## 3. What is already done, and what is still uncommitted

**Already done, and already in the history of this folder.** Do not redo any of it:

- The seven unpushed commits were **rewritten** to remove a privacy problem:
  `docs/design-swarms/wf_e0a73da7-d0f.jsonl` and `wf_efe56e46-b8b.jsonl` — raw agent-swarm
  transcripts — were deleted from every commit, and the absolute home path in
  `docs/ART-PROMPT-dog-fetch.md` and `docs/house-options/index.html` was replaced with `~`.
  All seven commit messages, authors and dates are unchanged. The pre-rewrite state is kept
  on the branch `backup/pre-scrub-2026-09-23`.
- The rewrite was verified: zero files containing `/Users/` across all seven commits, against
  a positive control of 14 files containing `MiniMe`. The tracked file count went from 190 to
  188.

**Still uncommitted, waiting for a commit under the owner's name.** Eleven paths:

| File | Change |
|---|---|
| `.gitignore` | ignores `docs/design-swarms/` |
| `.github/workflows/release.yml` | adds a `build-macos` job (unsigned `.dmg` + `.zip`, arm64 and x64) |
| `package.json`, `package-lock.json` | version `1.1.0` → `1.2.0` (three places) |
| `CLAUDE.md` | the "do not push anything upstream" house rule replaced; 59 → 298 assertions; two harnesses → four; "nothing is committed" → clean tree; date |
| `build2.md` | one dated addendum at the top; body untouched |
| `docs/BEHAVIOUR.md` | 59 → 298, two → four harnesses, plus the two missing harness bullets; date |
| `docs/CHARACTERS.md` | dog 12 files/11 used → 16/15; `carry`, `pickup`, `hold` rows added; date |
| `docs/superpowers/specs/2026-09-10-boredom-ladder-design.md` | "harnesses live outside the repo" corrected; a scoping note on the 59 figure |
| `docs/superpowers/specs/2026-09-22-dog-fetch-design.md` | status "designed, not built" → built, tested, committed |
| `CHANGELOG.md` | **new file**, written from the real `git log` |
| `GIT-COMMANDS.md` | **new file** — this runbook. Publishing it is optional: if the owner would rather keep it private, run `echo GIT-COMMANDS.md >> .gitignore` before `git add -A`, and it stays in the folder without reaching GitHub. Ask them. |
| `README.md` | nine factual corrections, all listed in section 4 |

Review the diff before committing:

```sh
git diff
git diff --stat
```

---

## 4. The README — already corrected, but the owner should read it

`README.md` described MiniMe as Windows-only while the branch being pushed is a macOS port.
Nine factual claims were corrected in the uncommitted diff. The owner has not yet read the
new wording, so **show them this list and the diff before pushing.**

| What it said | What it now says |
|---|---|
| platform badge `platform-Windows` | `platform-Windows | macOS` |
| "⬇ Download for Windows" | "⬇ Download for Windows or macOS" |
| water overlay "Alt-Tab closes it" | "Switching apps closes it" |
| "Never blocks `Ctrl+Alt+Del`, `Alt+Tab`, or Task Manager" | adds `Cmd+Tab` and Force Quit for macOS |
| nothing about fetch or the bone | a paragraph under **Pick your companion**, plus a Controls row |
| Windows SmartScreen note only | adds a macOS **Open Anyway** note — see section 10 |
| "double-click `START-MINIME.bat`" | names `START-MINIME.command` for macOS too |
| settings in `%APPDATA%\mini-me\config.json` | adds `~/Library/Application Support/mini-me/config.json` |
| "**Windows only** — relies on Windows transparent, click-through windows" | "**Windows and macOS**", with the signing caveat |
| developer file tree | adds `dock.js` and `test/`; `npm test` and `npm run dist:mac` documented |

One claim that was investigated and **left alone because it is true**: `README.md` says the
water overlay's **Esc skips it**, and that holds on macOS as well. `main.js:400` registers a
*global* Escape shortcut only on Windows, but the comment above it explains why — on macOS the
overlay is explicitly focused, so its own renderer keydown handles Escape, and a system-wide
grab there would swallow the key for every other app.

Verify the corrections are present:

```sh
/usr/bin/grep -c "platform-Windows-" README.md   # expect 0 (the old Windows-only badge)
/usr/bin/grep -c "Windows only" README.md        # expect 0
/usr/bin/grep -ci "bone" README.md               # expect > 0
```

---

## 5. Set the git identity

There is **no** identity configured, locally or globally. A commit will fail outright with
`fatal: unable to auto-detect email address`, and the value git prints inside that error is
built from the local account name and the machine's hostname. That is exactly why the identity
must be set explicitly rather than left to auto-detection: an auto-detected identity would
write a machine name into a public commit.

Use `--local`, never `--global`:

```sh
git config --local user.name  "<COMMIT_NAME>"
git config --local user.email "<COMMIT_EMAIL>"

git var GIT_AUTHOR_IDENT      # must now print the name and email, not "unknown"
```

All 20 existing commits share one identity, author and committer alike — read it with
`git log --format='%an <%ae> | %cn <%ce>' | sort -u`. Matching it keeps the history
consistent, but it is the owner's call.

---

## 6. Prove the code works before pushing

The test suite needs **no** `node_modules` — it is plain Node against `state.js`. Run it from
this folder as it stands:

```sh
npm test
```

Expected, measured in this exact folder on 2026-09-23:

```
exit code                 0
lines starting "PASS"     298
lines starting "FAIL"     0
final line                ALL PASS
```

Per harness: `ladder-sim.js` 30, `play-sim.js` 29, `facing-sim.js` 205, `fetch-sim.js` 34.

```sh
npm test 2>&1 | /usr/bin/grep -c '^PASS'   # expect 298
npm test 2>&1 | /usr/bin/grep -c '^FAIL'   # expect 0
```

One test is randomised (the dog's tease rate, about one throw in five), so its printed
fraction varies between runs — `51/200`, `40/200` and so on. The assertion still passes. A
`FAIL` on that line means a real regression.

`npm run verify:facing` needs the optional `sharp` dependency and will say so politely if it
is missing. That is not a failure. To run it: `npm install sharp` first, then expect
`63 frame pairs compared … 0 facing the wrong way`.

---

## 7. Final safety sweep — run it, do not assume it

Every one of these passes by finding nothing, so **each is paired with a positive control.
If a control returns 0, the command is broken and the clean result meant nothing.**

Use `/usr/bin/grep`, not plain `grep`. Inside some agent environments — Claude Code among
them — `grep` is a shell function routed to a tool that honours `.gitignore` and skips binary
files, so it silently misses things. Check with `type grep` if unsure.

**Exclude this file from every sweep below.** `GIT-COMMANDS.md` lists the patterns it is
searching for, so it matches all of them — `/Users/`, `/home/`, `BEGIN RSA`, `sk-ant-`,
`ghp_`, `AKIA`, `AIza` and the rest — as literal documentation text. Measured on 2026-09-23:
of the 190 files, the **only** file matching any of those patterns was this one, and every hit
was a pattern being quoted rather than a value. It also contains the deliberate slots
`<COMMIT_NAME>` and `<COMMIT_EMAIL>` from section 0, which will trip a placeholder sweep for
the same reason. The file list built below already excludes it. If you drop that exclusion,
expect a handful of false positives and no real ones.

```sh
# Build the file list as an ARRAY. zsh does not word-split a plain string
# variable, so an unquoted expansion runs the command once with every filename
# glued together, every path fails, and the check reports clean.
#
# Run this BEFORE the commit in section 8, so the two new files are included:
# git ls-files alone would miss them while they are still untracked.
# GIT-COMMANDS.md is excluded for the reason given above.
{ git ls-files; echo CHANGELOG.md; } | /usr/bin/grep -v '^GIT-COMMANDS\.md$' > /tmp/mm_tracked.txt
files=(); while IFS= read -r l; do files+=("$l"); done < /tmp/mm_tracked.txt
echo "${#files[@]}"                                            # expect 189
                                                               # (188 tracked + CHANGELOG.md,
                                                               #  minus this runbook)

# No absolute home paths, and no local account name.
# The account name is derived with whoami rather than written out, so this file
# does not match its own sweep — a runbook that spells out the string it searches
# for always reports a false positive on itself.
/usr/bin/grep -rlI "/Users/" "${files[@]}"                     # expect NO output
/usr/bin/grep -rlI "/home/" "${files[@]}"                      # expect NO output
/usr/bin/grep -rlIi "$(whoami)" "${files[@]}"                  # expect NO output
/usr/bin/grep -rlI "$(hostname -s)" "${files[@]}"              # expect NO output
# CONTROL for all four:
/usr/bin/grep -lI "MiniMe" "${files[@]}" | wc -l               # expect > 0 (measured 15)

# No credentials
for pat in 'BEGIN RSA' 'BEGIN PRIVATE' 'BEGIN OPENSSH' 'sk-ant-' 'ghp_' \
           'github_pat_' 'AKIA' 'AIza' 'password *=' 'secret *=' 'token *='; do
  printf "%-20s %s\n" "$pat" "$(/usr/bin/grep -rlIE "$pat" "${files[@]}" 2>/dev/null | wc -l)"
done
# expect 0 for every pattern. One known false positive if you widen the search:
# .github/workflows/release.yml has the comment "would need its own GH_TOKEN" — a
# comment, no value.
# CONTROL:
/usr/bin/grep -lI "electron" "${files[@]}" | wc -l             # expect > 0 (measured 14)

# Nothing enormous. GitHub refuses any file over 100 MiB outright.
while read -r f; do
  sz=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null)
  [ "${sz:-0}" -gt 104857600 ] && echo "BLOCKED: $f ($sz bytes)"
done < /tmp/mm_tracked.txt
# expect NO output. Largest tracked file is assets/reference/dogsheet.png at ~1.9 MB.
# CONTROL — same loop at threshold 0 must list every file:
while read -r f; do
  sz=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null)
  [ "${sz:-0}" -gt 0 ] && echo "seen"
done < /tmp/mm_tracked.txt | wc -l                             # expect the same count as above

# The transcripts really are gone from every commit, not just from the tip
for c in $(git rev-list origin/main..HEAD); do
  git grep -l "/Users/rajesh" "$c" -- 2>/dev/null
done
# expect NO output
# CONTROL:
git grep -l "MiniMe" HEAD -- 2>/dev/null | wc -l               # expect > 0 (was 14)

# Case-only filename collisions break a Linux checkout and CI
/usr/bin/tr 'A-Z' 'a-z' < /tmp/mm_tracked.txt | sort | uniq -d # expect NO output

# The big directories, and the removed transcripts, are genuinely ignored.
# The trailing slashes matter: this folder does not contain node_modules/ or
# dist/ at all, and without the slash git check-ignore cannot match a
# directory-only pattern against a path that is not on disk. It exits 1 and
# prints nothing, which reads exactly like a failed check.
git check-ignore -v node_modules/ dist/ docs/design-swarms/
# expect three lines: .gitignore:1, .gitignore:2 and .gitignore:15
git ls-files | /usr/bin/grep -c '^node_modules/'               # expect 0
git ls-files | /usr/bin/grep -c '^dist/'                       # expect 0
git ls-files | /usr/bin/grep -c '^docs/design-swarms/'         # expect 0
```

---

## 8. Commit

One commit for the whole documentation-and-packaging pass. Normal professional English in the
message — no informal voice, whatever voice the session is using in chat.

```sh
git add -A
git status                     # read it; confirm nothing unexpected is staged
git commit -F- <<'MSG'
Correct the docs, add a macOS release job, and bump to 1.2.0

The tracked documentation had drifted from the code. The test count was
recorded as 59 across two harnesses; it is 298 across four. CLAUDE.md
still described an uncommitted working tree and forbade pushing upstream,
neither of which is true now. The dog fetch spec still said "designed, not
built". The dog's character sheet was missing the carry, pickup and hold
poses.

The release workflow only ever built a Windows installer, so the macOS
port shipped to nobody. A build-macos job now produces an unsigned .dmg
and .zip for both Apple Silicon and Intel. The build is unsigned on
purpose: signing and notarising needs a paid Apple Developer account.

The README claimed the app was Windows-only, with a Windows-only platform
badge, a Windows-only settings path, no mention of the macOS launcher, and no
mention of the dog's fetch game at all. Those nine claims are corrected, and
the macOS Gatekeeper step a downloader needs is now written down.

CHANGELOG.md and GIT-COMMANDS.md are new. The changelog is written from the
commit history; the runbook records how this release was prepared and checked.
The version moves to 1.2.0, which covers twelve commits since v1.1.0 - five
that were already on main and never tagged, plus the seven on this branch.
MSG
```

**If the owner wants the attribution trailer used elsewhere in this project, ask them for the
exact line rather than inventing one.**

```sh
git log --oneline -1
git show --stat HEAD | head -30
```

---

## 9. Land the work — follow only the branch the owner chose

### If `LANDING` is `pr`

```sh
git push -u origin fix/per-frame-facing
```

`gh` was not installed on the machine this runbook was written on. If it is missing here too,
open the pull request in a browser: GitHub prints a "Compare & pull request" link in the push
output, or go to
<https://github.com/RudraMind/MiniMe/compare/main...fix/per-frame-facing> and click **Create
pull request**. Base `main`, compare `fix/per-frame-facing`.

If `gh` *is* installed:

```sh
gh pr create --base main --head fix/per-frame-facing \
  --title "macOS port, four new characters, dog fetch, and a test suite" \
  --body-file CHANGELOG.md
```

Stop here. Merging the PR is the owner's action.

### If `LANDING` is `merge`

```sh
git checkout main
git merge --ff-only fix/per-frame-facing    # must succeed; 0 behind was confirmed in section 2
git push origin main
```

`--ff-only` is deliberate: if it refuses, the remote moved and you must stop and ask, not
merge anyway.

### If `LANDING` is `branch`

```sh
git push -u origin fix/per-frame-facing
```

Then stop. Nothing lands on `main`.

---

## 10. Release v1.2.0 — only if `DO_RELEASE` is `yes`, and only after the work is on `main`

A tag on a branch that is not merged will build installers from that branch. Confirm with the
owner which commit the tag belongs on.

```sh
git checkout main
git pull --ff-only origin main
/usr/bin/grep '"version"' package.json | head -1     # must read 1.2.0
git tag -a v1.2.0 -m "MiniMe 1.2.0 - macOS support, four new characters, dog fetch"
git push origin v1.2.0
```

That tag matches `on: push: tags: ['v*']` and starts both CI jobs.

### What CI will produce, and what it will not

| Job | Runner | Output | Attached to the release |
|---|---|---|---|
| `build-windows` | `windows-latest` | `dist/*.exe` (NSIS installer, per-user, no admin) | yes |
| `build-macos` | `macos-latest` | `dist/*.dmg` and `dist/*.zip`, arm64 and x64 | yes |

Watch it at <https://github.com/RudraMind/MiniMe/actions>. Both jobs use
`if-no-files-found: error`, so a silent empty upload is not possible.

Then verify the release really has assets, from any machine:

```sh
curl -s https://api.github.com/repos/RudraMind/MiniMe/releases/latest \
  | /usr/bin/grep -E '"tag_name"|"name"|"size"'
```

Expected: `v1.2.0`, plus one `.exe` of roughly 87 MB, one or two `.dmg` and one or two
`.zip`. For comparison, measured on 2026-09-23: `v1.1.0` carries
`MiniMe-Setup-1.1.0.exe` at 87,289,177 bytes and `v1.0.0` carries
`MiniMe-Setup-1.0.0.exe` at 87,304,508 bytes — so the Windows half of this pipeline is
already proven twice over.

**The macOS half has never run.** Treat the first `build-macos` run as unproven and read its
log rather than assuming it worked.

### The honest caveat, verified against Apple's own documentation

The macOS artifacts are **not code-signed and not notarised**. `package.json` sets
`"identity": null`, which in electron-builder means *skip signing entirely* — not ad-hoc sign:

> "null: skip signing entirely."
> — <https://www.electron.build/docs/api/app-builder-lib.Interface.ElectronSignOptions>

A local build from this source measures `codesign --verify --deep --strict` → exit 1 and
`spctl --assess --type execute` → exit 1. The `Signature=adhoc` that `codesign -dv` reports is
the unmodified prebuilt Electron binary's own signature — `Identifier=Electron`,
`TeamIdentifier=not set`, `Sealed Resources=none` — not something electron-builder applied.

**What a macOS downloader actually sees.** Apple documents the alert as:

> "Apple cannot check 'Example App' for malicious software", with options to "Move to Trash"
> or "Done".
> — <https://support.apple.com/en-us/102445>

**And the one trap worth knowing.** Control-clicking the app to open it no longer works:

> "In macOS Sequoia, users will no longer be able to Control-click to override Gatekeeper when
> opening software that isn't signed correctly or notarized. They'll need to visit System
> Settings > Privacy & Security to review security information for software before allowing it
> to run."
> — <https://developer.apple.com/news/?id=saqachfa>, 6 August 2024

The documented path is **System Settings → Privacy & Security → Security → Open Anyway**, then
the login password. That button is only available for about an hour after the first attempt
(<https://support.apple.com/guide/mac-help/mh40616/mac>). `README.md` now spells this out for
users.

**To remove the friction properly** needs a Developer ID Application certificate plus
notarisation, and therefore a paid Apple Developer Program membership:

> "The Apple Developer Program is 99 USD per membership year."
> — <https://developer.apple.com/programs/enroll/>

That would mean setting `mac.notarize`, `mac.hardenedRuntime` and an entitlements plist,
removing `"identity": null`, and adding these repository secrets to the workflow:
`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID` (<https://www.electron.build/docs/features/code-signing/notarization>).
**Do not attempt this without the owner buying the membership first.**

**Windows is unsigned too**, and the README already documents it. Microsoft's own wording for
an unsigned file is a "Windows protected your PC" warning where the "User must choose 'Run
anyway' before the app can run"
(<https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation>).
That page also notes Windows 11's Smart App Control "will block execution of unsigned files
unless the file has a positive reputation", so some Windows 11 machines may refuse outright.

---

## 11. Undo

| To undo | Command |
|---|---|
| the local commit from section 8, before pushing | `git reset --soft HEAD~1` |
| the history rewrite, restoring the transcripts and the absolute paths | `git reset --hard backup/pre-scrub-2026-09-23` |
| everything, completely | delete this folder. It is a snapshot copy. The untouched original is at `~/Claude/projects/MiniMe` on the machine that produced it. |

**Once anything is pushed, undo stops being local.** A pushed commit can only be reverted with
a new commit, and a pushed tag should be left alone. There is no situation in this runbook
that calls for `git push --force`.

---

## 12. Report honestly

State which sections ran, which checks passed with their actual numbers, and which were
skipped and why. If `npm test` printed a `FAIL`, say so and paste the line. If a push was
rejected, paste the error. A check that could not be run is **unverified**, never a pass.
