# Beta-readiness audit

A whole-repository audit: every subsystem read, every defect proved with a
repro before it was touched, and a regression test added wherever a suite could
have caught the bug and did not.

This document is the record. It lists what was fixed, what was investigated and
found *not* to be a defect, and what is still open — because a list of only the
good news is not an audit.

---

## The starting position was smaller than it looked

Ten suites ship and all ten reported success. Three of them were not doing what
their output implied:

| Suite | Before | After |
|---|---|---|
| `test-studio-audit.mjs` | **crashed at check 76** — `readFileSync` on a path outside the folder throws rather than failing a check, so 505 later checks never ran | 582 pass |
| `test-studio-modules.mjs` | **crashed before its summary**, same cause | 47 pass |
| `test-studio-cloud.mjs` | **skipped itself and exited 0** — it looked for the studio at a hard-coded `/tools/media-studio/` and reported "no live backend" for a backend that was answering | 38 pass |
| `test-studio-units.php` | 112/113 (`api/.htaccess` missing) | 124 pass |
| `test-studio-api.php` | never run in CI, and failed on a second run against the same install | 55 pass, twice |
| the other five | green | green |

There was also no CI, so nothing ran any of them on a push.

**Total now: 2227 checks across ten gated suites, plus 93 against a live backend.**

---

## Critical

### The installer opened for anonymous visitors

`StudioInstall::needsReconfirm()` tested "is there a secret to check against?"
*before* "is this install finished?", so a completed install with no database
password and no `setup.secret` answered **no key needed** — and handed the whole
wizard to whoever asked. From there: re-point the install at a database you
control, and create yourself an account at step 5.

Not an exotic state. `server/env.example.php` ships with both fields empty and
copying it by hand is a documented way to configure the studio, so every
socket-auth install set up that way had an open installer on the public web.

The lock is now tested first, and where there is genuinely nothing to check a
key against the wizard refuses outright — no key could ever be right, so
demanding one would be theatre — naming the two server-side changes that re-open
it. *Both* agents auditing that file found this independently.

### The boot sweep deleted a project's media

The orphan sweep removes every stored asset the runtime library does not refer
to. That is a safe root set only when the author's own document loaded, and
loaded completely. A restore that **threw** left the library empty while the
project sat intact on disk — so the sweep read every one of its assets as an
orphan and deleted them all, one block after the warning that told the author
*"the saved copy is untouched"*. The document survived; every clip it pointed at
did not.

The share-link case was already guarded by exactly this reasoning. The rule is
now one exported predicate, `maySweepOrphans()`, covering both.

### A black frame at every timeline join

A clip's length is `(out − in) / speed` — a repeating fraction at any speed but
1 — while the schedule publishes starts rounded to 1/100 s. `scheduleOf`
accumulated the raw value and published the rounded one, so the two drifted
apart at every join and compounded down the sequence. `renderTimelineFrame`
fills black and composites whatever covers `T`, so an instant covered by nothing
is not a seam: it is a black frame, in the preview and in the export.

Measured over 4000 random sequences with speed varied: **6215 joins carrying a
gap, worst 9.8 ms**. At 30 fps that is roughly one join in three landing a
sampled frame inside one.

Fixed in two places, because either alone leaves a smaller version of it:
`scheduleOf` continues from the start it published, and a clip holds the picture
until the next one takes it (`spineSpans()`). Swept at 24/30/60 fps: 691,352
sampled frames, none uncovered.

### A redaction that could be read

Redacted Document wrapped its body as plain text and *then* looked for `[[…]]`
on each finished line. The line breaker splits on whitespace — and on character
for an over-long token — so a marker could land as `[[Dr. Ellis` / `Webb of
LAB-3]]`. Neither half matches, so neither gets a bar, and both are drawn as
ordinary ink: the author's secret printed in the clear, brackets included, on
the one template in the set whose entire purpose is that it is not.

A redaction is a property of the span, not of the characters, so
`redactedLines()` returns runs and treats each marker as unbreakable. Asserted
at six measures from 400 px down to 20 px.

### Seven selects blanked on the first edit, killing both effect chains

`index.html` declares seven selects with no `<option>` children — the lists come
from the registries at init time, which runs long after `startSession` seeds the
document from the markup. So the value recorded as their boot default was the
**empty string**, and `renderDocToDom` writes the document back to the DOM on
*every* notification, including the author's own edits.

Measured: **one move of the Scanlines slider drove all seven to
`selectedIndex = -1`.** After that `＋ FILTER` and `＋ FX` were no-ops answering
*"Pick one first"* — the two headline features the HELP tab advertises, dead on
the author's first interaction with any control — and `＋ KEY` silently wrote a
keyframe onto whatever the first automatable parameter happens to be, while its
picker showed nothing.

The comment directly above `startSession` states the invariant these seven
violate: *"Selects must already be filled, or their .value would not yet be the
real default the markup implies."*

Fixed in three layers, because each one alone leaves a way back in:

- The five **pickers** (`v-filters-pick`, `a-fx-pick`, `v-auto-param`,
  `a-region-op`, `i-anno-kind`) are no longer document state at all. They say
  "which one to add next" — a question, not an answer — and belong beside the
  scrubbers in `NOT_DOCUMENT` for the reason already written there: *a readout is
  not state*. A project file should not carry the last filter you were about to
  add.
- The two **container** selects are real project state, so they are now filled
  *before* the document is seeded, which is what the invariant asks for.
- `writeControl` refuses to write a value onto a `<select>` that has no matching
  option, so the next ordering slip is invisible instead of breaking two
  features.

This one was found by the audit's own adversarial verifier after the first pass
had dismissed it, which is the argument for running the verify phase at all.

### `api/.htaccess` was missing from the repository

Load-bearing, not hardening: without it Apache 404s every request to
`<studio>/api/*` and the CLOUD tab reports "No backend found" on a healthy
install. `StudioPreflight` checks for it by name and `setup.php` warns about it
— because FTP clients skip dotfiles silently, which is almost certainly how it
was lost.

---

## High

| | |
|---|---|
| **Video In exported frozen** | The VIDEO tab's four export paths each asked `hasImportedVideo()` — the single active import slot — to decide whether a clip plays footage. A clip whose Footage names a **library row** (the ordinary case after a reload) answered "no footage" to all four: WebCodecs encoded the whole clip from one never-advanced frame, and `.gif`/`.apng`/`.webp`/frame-strip never seeked the footage at all. |
| **Exports were not reproducible** | The offline path never reset the phosphor buffer, so with Persist above zero it opened on a ghost of wherever the scrubber was — and the same project exported twice produced two different files. The batch exporter had the same bug per item, so a contact sheet's items bled into each other. |
| **Stereo width silenced the right channel** | A `ChannelSplitterNode` is explicit/discrete by spec, so a mono input arrives with channel 1 as silence; `outR` works out to `0.5·L·(1 − width)`, which at the shipped default width of 1 is exactly zero. At width 0 — "collapse to mono" — both channels came out 6 dB quiet. |
| **Halftone rotated the picture, not the screen** | On flat grey, **16% of the frame was blank paper at the shipped 45° default**, 20% at 90°, with the content dragged toward the centre. Now 0% at every angle. |
| **"Row RGB Shift" shifted no channels** | Two whole-colour copies under `lighter`, plus a `ctx.filter` pointing at an SVG filter this document does not define. On flat grey it produced flat grey — max channel spread **0** — with a third of the frame blown to white. |
| **The share-token rate limit did not limit** | The limiter keyed on the request path, so `/studio/shared/:token` gave every distinct token its own bucket: the endpoint whose whole job is resisting token guessing offered 30 attempts *per token*, and each attempt minted a JSON file in the rate-limit directory from an unauthenticated request. Keyed on the route pattern now — verified: 34 different tokens, one bucket, 429 from the 31st. |
| **Upload sessions belonged to nobody** | `initUpload()` recorded the owner and nothing read it back. An account holding another account's `uploadId` could inject chunks into that transfer, or finish it and take the asset. |
| **Four scenes were frozen pictures** | SMPTE Color Bars and Surveillance Cam declared `t` and never read it. Elevator computed a chime alpha above 1 — which the canvas ignores — and stopped moving entirely on a single-line floor list. Station Sign-Off animated only its closing fade. |
| **EKG went flat from the left** | JavaScript's `%` keeps the dividend's sign, and the dividend is negative behind the playhead, so the QRS windows could never match there. |
| **The razor cut in the wrong place** | `splitAtPlayhead` added a *sequence* offset to a *source* position. At 2× a razor on the visual midpoint cut a quarter of the way in; on a reversed clip it measured from the wrong end, so the halves played in the wrong order. |
| **Nine templates ignored the Title box, three ignored Body** | An author typing in a box and watching nothing happen, with nothing to say which box that template reads. |
| **A backwards trim ate the trim** | Typing `1` into Out on a clip trimmed to 2–8 discarded the whole trim and reset the clip to full length, silently. |
| **The per-section ↺ did nothing** | On the six panels whose contents are not controls (FILTERS, FX CHAIN, MARKS, LAYERS, KEYFRAMES, audio EDITS) it toasted "Section reset" over an untouched chain. On QUICK LOOK it did the opposite: restoring the two write-only macro dials *fired* them, overwriting twelve hand-set CRT controls in the fieldset below. |
| **Auto-level skipped the clipping case** | The guard excluded any render peaking at or above 0.985 — the one case the control exists for. |
| **A look did not survive a format change** | 20 of the 32 pixel parameters hit their ceiling on the default 320×240 → 1920×1080 move. The ranges were authored when the frame was 320-ish and never widened when `MAX_DIM` became 1920, so the look did not carry *and* a there-and-back switch permanently shrank the author's settings. |
| **A frame cap changed the speed** | The animated stills cap N at 240 frames but spread them across the whole clip, then took the per-frame delay from the *requested* rate. A 60s clip at 20fps played in **12 seconds** — a fifth of its real length. The delay now comes from the duration those frames cover, which is arithmetically identical whenever the cap is not reached. |
| **Credits Crawl opened and closed on black** | It began below the bottom edge, so `t=0` drew nothing at any speed; and the travel had no reference to the clip length, so at cps 2 a 10s clip was empty for five seconds and at cps 40 it had left by 9.9s. It now starts on screen and comes to rest on its final card. |
| **Two templates drew a multi-line body as one line** | Boot Splash and Vapor Desktop passed the whole body to one `glowText`; canvas `fillText` does not break lines. Measured on a four-line body: 3 bands of type → 6, and 1 → 4. |
| **A dead share link disabled autosave forever** | `arrivedByShareLink` was read from the URL before the token was tried, and a failure put the fragment *back* — so a revoked token meant "a reader is viewing someone else's project" on every subsequent load, and the reader's own work was never saved. A failed share is now an ordinary visit, and a 403/404 does not restore the fragment because there is nothing to retry. |
| **The RECORD button lied about the format** | Hard-coded `● RECORD .webm` in the markup with nothing ever re-syncing it, so choosing MP4 left the button naming a file the export would not write. |
| **Preflight could report storage protected on a host that serves it** | It fetched `server/data/.htaccess`, and hosts commonly deny dotfiles by name while serving everything else in the tree — so it reported "present and enforced (live-checked)" over a publicly fetchable storage tree. It now writes a canary with an ordinary filename, fetches that, and deletes it. A false OK on a check advertising itself as live-checked is worse than no check. |
| **The reconfirm key travelled in a URL** | And it is the database password. Still accepted from the query string — the only practical way in from an address bar — but taken once into the session and 303'd away, with `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: no-store` on every page of the wizard. |

## Medium and below

Document integrity: `parsePath` returned **array** paths unchecked, so the
prototype-pollution ban this module exists to be could be walked past by passing
the segments as a list. `getPath`/`hasPath` walked the prototype chain, so
`hasPath(doc,'tabs.video.toString')` was true. An easing name was validated by
truthiness of `EASES[e]`, so `e: "toString"` was accepted, written into the
document, and evaluated as `Object.prototype.toString` — making the
interpolation **NaN**, which then reached the renderer as a parameter and
survived a save.

Also: `"Crop to"` discarded the ends the edge fades were ramped onto, so every
cropped `.wav` clicked at both edges; Crosshatch read only the y component of
its direction table, so no vertical hatch was ever drawn; the Glitch slider sat
in the CRT/VHS FX panel and did nothing on 47 of the 48 scenes; the empty
FILTERS panel named a drag gesture that does not exist; no favicon, so every
page load 404s — on a subdirectory install, against somebody else's site.

---

## Medium, fixed

- **A throwing `drawFrame` leaked the `VideoEncoder`.** `drawFrame` is arbitrary
  caller code — a scene, a filter chain, an author's keyframe curve — and
  `encoder.close()` sat *after* the loop, so a throw propagated out with the
  hardware handle still open and configured. Chromium caps how many encoders a
  page may hold, so a few failed exports in a row stopped being able to export
  at all — reported as *"WebCodecs is unavailable"*, which is a different problem
  with a different fix. Now a `try/finally`, with `flush()` still inside so a
  successful run is ordered exactly as before.

- **A 65th clip diverged the document from the sequence.** `normalizeClips`
  slices to `MAX_CLIPS`, but `commitClips` wrote the document from the *unsliced*
  array — so the store held 65 while the sequence played 64, a disagreement that
  survives a save and a reload. All five add paths then toasted
  *"Clip added (64)"*: a number that reads as success and is really the count of
  clips that survived the one just thrown away. The cap is now enforced at
  `commitClips` (the choke point every edit funnels through) and refused out loud
  before a clip is built.

  *Worth recording how nearly this test was useless:* the first version nudged a
  clip after the add to observe the document, and that nudge rewrote it from the
  already-normalised runtime — erasing the divergence and passing with the fix
  removed. It now reads the document with nothing in between, and is verified in
  both directions.

- **The preset picker and the SAVE button disagreed about the same rule.**
  `renamePreset` refuses to rename onto an occupied name (*"X already exists"*),
  while `saveUserPreset` wrote `all[name] = readRecipe(...)` straight over
  whatever was there — silently, on a name typed into a `prompt()`, where a typo
  or a half-remembered name is the ordinary case and the thing destroyed is a
  look somebody built by hand and cannot get back. Overwriting is legitimate (it
  is how you iterate on a preset), so this now confirms rather than refuses.
  Names are trimmed too: `" Mine"` and `"Mine"` are one name to a person and
  were two entries here.

- **Renaming or deleting the selected preset blanked the picker.**
  `rebuildPresetSelect` restored the previous selection without checking that it
  still existed, so writing a name the rebuilt list no longer held left
  `selectedIndex` at `-1` — a blank control whose entire job is to say which look
  is loaded. Measured: `{value: "", index: -1}` after deleting the selected
  preset, and the same after renaming it. Delete now falls back to
  `— custom —` (honest: the loaded preset is gone, and what is on screen is
  nobody's preset), and rename carries the selection to the new name.

- **The wizard locked itself only when it created the *first* account.** Every
  other route through step 5 left `server/config/.setup-complete` unwritten:
  *Skip — I have an account* (offered whenever the database already has
  accounts) and creating a second account both fell through. That is not
  cosmetic. `needsReconfirm` returns `false` when there is no secret to check a
  key against, and `server/env.example.php` ships with an empty database
  password *and* an empty `setup.secret` — so a socket-auth install configured
  by copying it, on a database that already had a user, had a wizard that opened
  for anonymous visitors indefinitely. Same failure mode as the Critical item
  above, reached by a different door. Locking now happens on arrival at step 6
  whatever route got there, the Done page says so on its own line, and a lock it
  could not write is reported instead of passed over.

- **`account.php` took the password as an argument.** An argument is visible to
  every user on the box in `ps`, is written verbatim into `~/.bash_history`, and
  on shared hosting is often in the process accounting log as well — which made
  the one command whose job is to set a credential the one command that leaked
  it. It now asks, with the terminal's echo off (and says so if it cannot turn
  echo off, rather than quietly showing the password), confirms by asking twice,
  and accepts a pipe for scripts: `printf '%s' "$PW" | php server/account.php
  add alice`. An argument still works and still warns. `add` checks the name
  before asking, so a password is never typed for an account that cannot be
  created. CI and both install docs now use the pipe.

- **The generated deny file emitted a bare `Require all denied`.** On Apache 2.2
  there is no `mod_authz_core`, `Require` rejects the `all` provider at
  parse time, and in a `.htaccess` a parse error is a 500 on every request into
  that directory — so a file written to lock a folder down took the studio
  offline instead, with nothing to connect the two. The 2.2 syntax beside it was
  already fenced; both are now.

---

## Investigated and found NOT to be defects

Recorded because "we looked and it was fine" is a result.

- **"Six option-less selects make boot record `""` as their default."** Filed as
  a non-defect on a first pass and that was **wrong** — see
  *Seven selects blanked on the first edit* under Critical. The first
  measurement asked whether RESET blanked them (it does not) and never tried the
  path that actually breaks: the document→DOM write that follows any ordinary
  edit. The finding was right, the count was seven rather than six, and the
  repro is one slider move rather than a reload.
- **"Halftone is 3–9× slower than any other filter."** Not supported by
  measurement; the claim's own numbers contradicted it.
- **"Crosshatch never reads `dirs[k][0]`."** True when filed, already fixed by
  the time it was verified.
- **"`scaleFilterPx` clamping is a bug."** The clamp is deliberate and asserted
  by an existing test. The defect was one level up: the registry's ranges were
  too narrow to scale into. Fixed there.

---

## Still open

None of these are fixed. They are recorded with enough detail to act on.

**Export**
- MP4 muxing throws `RangeError` past roughly 14 minutes and falls back to WebM
  after a full encode.

**Timeline**
- A trim/reorder drag that pauses for over 600 ms splits into several undo
  entries.
- Undecodable footage retries the decode on every preview frame.
- A dip/burn duration is not bounded by the clip it belongs to.

**Backend**
- Quota counts assets only; project documents and their 50-deep autosave history
  are unbounded and unmetered.

**Client and UI**
- The command palette's catalogue is frozen at boot, so saved presets are never
  findable.
- `#v-flash` is a permanently-live region that rewrites four times a second.
- The editor layout overflows horizontally below ~500 px (WCAG 1.4.10).

**Repository**
- **There is no `LICENSE`.** That is an ownership decision, not one this audit
  should make. Nothing else here is blocked on it, but a beta without one is a
  beta nobody can legally build on.

---

## How to re-run any of this

```bash
bash scripts/ci-gate.sh                 # the ten suites
bash scripts/ci-gate.sh --headless      # skip the four Chromium ones
bash scripts/ci-gate.sh --no-skip       # a skipped gate fails the run (what CI uses)

php -S 127.0.0.1:8090 router.php        # then, in another terminal:
php  test-studio-api.php   http://127.0.0.1:8090
node test-studio-cloud.mjs http://127.0.0.1:8090
```

CI runs all of it on every push, plus a job that copies the checkout three
directories deep and runs the headless gate from there — because "copy the
folder anywhere and it works" is the studio's central promise, and it is the
promise this audit found three separate violations of.
