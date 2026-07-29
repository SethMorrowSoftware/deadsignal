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

**Total now: 2216 checks across ten gated suites, plus 93 against a live backend.**

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
- The 240-frame cap silently speeds up a long GIF/APNG/WebP rather than dropping
  frames or refusing.
- MP4 muxing throws `RangeError` past roughly 14 minutes and falls back to WebM
  after a full encode.
- `encodeClip` has no `try/finally` around the encode loop, so a throwing
  `drawFrame` leaks the `VideoEncoder`.
- `runBatch` takes no export lock and stops no preview, so it can run
  concurrently with a clip export over the same scratch canvases.
- STOP does nothing during the APNG/WebP encode phase, which also shows no
  progress.
- 2×SS is silently ignored by the still exporters.

**Scenes and screens**
- Credits Crawl draws nothing at `t=0`, and nothing at all at low speeds.
- Emergency Alert's crawl leaves the screen empty for 3.6 s of every 15.7 s.
- The shared layer canvas is not reset between layers, so a scene renders
  differently depending on which layer precedes it.
- Boot Splash and Vapor Desktop draw a multi-line body as one overlapping line.
- Error Dialog hard-codes a 140 px window height, so its title bar leaves the
  top of a short frame.
- Ink/Ground are enabled all-or-nothing, so nine templates keep a colour control
  that does nothing.
- A stego message too large for the canvas is dropped silently on export.
- "Invert text" writes nothing on light-stock templates.

**Timeline**
- A trim/reorder drag that pauses for over 600 ms splits into several undo
  entries.
- Undecodable footage retries the decode on every preview frame.
- Adding a 65th clip writes it to the document, drops it from the sequence, and
  reports success.
- A dip/burn duration is not bounded by the clip it belongs to.

**Backend**
- Quota counts assets only; project documents and their 50-deep autosave history
  are unbounded and unmetered.
- `account.php` takes the password as a command-line argument, exposing it in
  `ps` and shell history.
- The generated deny file emits an unguarded `Require all denied`, which 500s on
  Apache 2.2 — unlike the `api/.htaccess` this audit added, which fences every
  directive behind `<IfModule>`.
- Preflight can report `server/data/` protected on a host that serves it.
- The install does not lock itself when the account step is skipped.

**Client and UI**
- A share link that fails to open permanently disables autosave for that URL.
- Renaming or deleting the selected user preset leaves the picker blank.
- Saving a preset over an existing name destroys it without asking.
- The command palette's catalogue is frozen at boot, so saved presets are never
  findable.
- The RECORD button's format label does not re-sync from the document, so it can
  claim `.webm` while the export writes `.mp4`.
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
