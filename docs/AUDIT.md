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
| `test-studio-audit.mjs` | **crashed at check 76** — `readFileSync` on a path outside the folder throws rather than failing a check, so 505 later checks never ran | 628 pass |
| `test-studio-modules.mjs` | **crashed before its summary**, same cause | 52 pass |
| `test-studio-cloud.mjs` | **skipped itself and exited 0** — it looked for the studio at a hard-coded `/tools/media-studio/` and reported "no live backend" for a backend that was answering | 38 pass |
| `test-studio-units.php` | 112/113 (`api/.htaccess` missing) | 135 pass |
| `test-studio-api.php` | never run in CI, and failed on a second run against the same install | 59 pass, twice |
| the other five | green | green |

There was also no CI, so nothing ran any of them on a push.

**Total now: 2305 checks across ten gated suites, plus 97 against a live backend.**

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

Three items. None blocks the beta.

**Repository**
- **There is no `LICENSE`.** That is an ownership decision, not one this audit
  should make, and it is deliberately left out. Nothing else here is blocked on
  it, but a beta without one is a beta nobody can legally build on.

**Verification**
- **Everything is verified in Chromium only.** All four browser suites drive
  Chromium; Firefox and WebKit are untested. Specific known risk points in this
  codebase: canvas `letterSpacing` (Firefox does not implement it — guarded, so
  type *renders differently* rather than crashing), WebCodecs, `captureStream`,
  IndexedDB in Safari private mode, and H.264/MP4. `⎘ COPY DIAGNOSTICS` reports
  each of these, so a beta tester on another engine can say which are missing.

**Accessibility**
- **Disabled buttons are unreachable by keyboard.** `disabled` removes an
  element from the tab order, so a keyboard-only or screen-reader author never
  lands on ▶ PLAY and never hears the tooltip added in round four explaining
  that ◆ RENDER comes first — they simply do not learn the button exists.
  Fixing it means `aria-disabled` plus a refusal in every affected handler, and
  the handlers are spread across five files. Recorded rather than rushed.

Every other finding this audit raised has been either fixed above or recorded
under *Investigated and found NOT to be defects*. Two caveats on that, because
"the list is empty" is a weaker claim than it looks:

- **40 of the 128 workflow agents died on API 529s.** The findings they had
  already filed were worked through; whatever they had not yet filed was never
  seen. This is an audit of what was looked at, not a proof that nothing else
  exists.
- **Two of the reported numbers did not reproduce**, and both are recorded as
  measured rather than as filed: the MP4 ceiling is around 66 minutes rather than
  14, and the editor's reflow broke at about 600 px rather than 500. A finding
  worth fixing can still be wrong about its own detail.

---

## Round four: a field that lied about its own value

**Every number field kept a value it would never honour, and saved it.**
`<input type="number">` clamps only its own steppers, so a *typed* number stayed
in the box however far outside its declared min/max it was — while every reader
in the tool goes through `clamp()`. The picture was therefore right and the
control, the document and the project file all said something else.

Measured on a stock build: typing **1299 into FPS (max 30)** rendered at 30,
stored `"1299"` in the document, and wrote `"1299"` into the saved project — a
number no build of this tool will ever honour, travelling with that project
forever, with nothing said. Duration `9999 → 60`; width `−50 → 64`. **All 53
bounded number inputs behaved this way.**

The deep suite already asserted that every field *declares* min and max. It
turns out declaring a bound and enforcing one are different claims, and only the
first was being made.

Now clamped on `change` — the commit point, never on `input`, because correcting
mid-keystroke would make typing "50" into a field with a minimum of 10 snap to 10
after the "5". A blank box is left blank (that is a field being cleared, and
every reader already defaults it), an in-range value passes through untouched and
unremarked, and a correction is announced, because a number that changes under
your hands without a word is its own bug report.

The clamp hangs on `document` in the capture phase rather than on the document
binding, and that matters: two of the fifty-three live outside project state —
`bx-seconds`, which caps how long each item in a batch runs (a 45-item batch at
the 1599 the box would accept is twenty hours of encoding), and
`cloud-share-days`, whose number is sent to the server. Being held to an
advertised bound is a property of the field, not of whether it happens to be
project state.

**Autosave could stop working without a word the author would notice.**

The tool's promise is that the session comes back after a reload, and *nothing on
screen said whether that was true*. A failing autosave — a full IndexedDB quota,
a closed database, a private window that revoked storage mid-session — called
`onError` on every write, and boot's handler wrote one line into the CONSOLE
panel each time. Measured: **ten ordinary edits produced ten identical
"Autosave failed" lines, no toast, and no indicator anywhere.** Work could stop
being kept and the only trace was in a scrolling panel nobody watches.

Two halves:

- **A readout in the header.** `✓ saved 16:49` when the session is being kept,
  `⚠ NOT SAVING` when it is not. `role="status"` rather than a live region — it
  is there to be glanced at, not recited on every save.
- **The transition is what gets announced, not the event.** `autosave()` now
  tracks whether the previous write failed and tells the caller which write is
  the *first* failure of a run and which is the *recovery*. So a broken backend
  produces one toast — "Not saving — save a project file" — instead of a stream
  of them, and one line when it starts working again. Verified: 10 consecutive
  failures, 1 announcement.

Same hysteresis discipline as the flash meter: a state worth interrupting for is
worth interrupting for **once**.

### One nudge, three undo entries

The two Format/Aspect pairs per panel were the last selects still filled at
*tab-init* rather than before the document was seeded from the markup, so their
recorded boot default was `""`. The first ordinary edit anywhere in the video
view therefore ran `wireLive → syncFormat`, which derived a Format from W and H
and wrote it, whose own change handler then wrote an Aspect.

Measured on a stock build: **one nudge of the Scanlines slider cost three undo
entries**, and the first two undid a Format and an Aspect nobody had chosen.
Adding a single filter cost three as well — and *one* undo left the filter in
place, which is the version an author actually notices.

`primeSizing()` now seeds all three pairs from the frame size before
`startSession`, alongside the container pickers that were fixed for the same
reason earlier in this audit. Afterwards: one nudge, one entry; one filter, one
entry; one undo takes the filter back off.

Worth recording how the test for this went wrong first. Written inline in the
deep suite it passed *with the fix reverted*, because by the time it ran the
suite had already made its first edit two hundred checks earlier — which on a
broken build is precisely the edit that fills Format and Aspect in. There is
only ever one first edit per page, so the measurement now opens its own fresh
context, and the filter half opens a second one. Reverted, all five checks go
red; restored, all five pass.

### A modal dialog that flashed at everyone

`#welcome` was visible in the markup so that a cold start would show it at the
first paint rather than waiting for sixty modules to load. But the same wait
applied to *hiding* it: `initWelcome()` — the thing that closes it for a
returning author — runs two hundred lines into `boot()`. So an author who
dismissed the card months ago got a flash of a modal dialog on every single
load, **and every click during that flash landed on the dialog instead of the
tool**. Measured: visible for **16 of the 17 frames** boot takes.

This is also the answer to the intermittent CI failure recorded further down —
a tab click "intercepted by `#welcome`" that no amount of re-running would
reproduce reliably.

The card now starts closed and a cold start *opens* it, which puts the cost on
the case that wants a dialog: a first-run visitor sees it a moment after the
tool paints. Measured after: **0 of 20 frames**.

### A readiness signal that meant nothing

The four browser suites all waited on `window.DeadSignalStudio && #v-scene has
options` before touching the page. `window.DeadSignalStudio` is assigned at
*module-evaluation* time — before `DOMContentLoaded`, so before `boot()` has run
a line — and the scene picker is filled in boot's first dozen. A boot that threw
anywhere after that still satisfied the gate, and the suite went on clicking at
a half-wired page.

`boot()` now sets `document.documentElement.dataset.studio = "ready"` on its last
line and fires a `deadsignal:ready` event; every suite waits on that instead.

Proven rather than asserted: the suite serves one module as a stub whose
`initSections()` throws, and checks both gates against that page. The old one is
satisfied. The new one is not. The check that would have been the "run it
backwards" step is a passing check in its own right.

### Import failures that said nothing an author would see

Three, all the same shape — the tool refusing work and keeping the reason to
itself:

- **A bad image logged to a closed console and raised no toast.** Its video
  sibling has always toasted. So dropping a `.txt` on the SCREEN tab looked
  exactly like dropping nothing: the old image stayed on the canvas, and the one
  line of explanation went to a panel that is collapsed by default.
- **`FileReader`'s own error was not handled at all**, so a file the browser
  cannot read — removed drive, permissions — failed in complete silence.
- **A file with no picture in it was accepted.** An `.mp3`, an audio-only
  `.mp4`, or a container whose video track this build cannot decode reaches
  `onloadedmetadata`, not `onerror`. The log read `Imported video 0×0`, the toast
  read "Video imported", **`v-dur` was rewritten to the clip's length**, and the
  canvas went on showing "DROP or LOAD a video clip". Now refused where it
  arrives, leaving the previous clip and the duration alone.

Each now names what failed, on which file, and what the tool can actually open.

### The safety net under the one irreversible click, silently off

Loading a project replaces the document and clears the undo stacks.
`stashPreviousProject()` is the net: it keeps the outgoing document in
localStorage so a misclick is recoverable. Its write can fail — a full
localStorage, a private window, a document over the 5 MB quota — and it returned
`false` into a caller that **ignored the return value**, mentioning it only in a
line of the closed console.

Reproduced by genuinely filling localStorage (104 chunks, then topping off in
smaller sizes until a 4 KB write throws) rather than stubbing it: the stash
failed, the load proceeded, and the project was gone. It still cannot refuse the
load — every programmatic caller would break — but it now says so on the same
channel that announces the load itself.

### Greyed-out buttons that would not say why

Eight buttons are disabled the moment the page opens and not one carried a
`title`, an `aria-description`, or anything else naming what would switch it on.
The worst is the Audio panel: **▶ PLAY, ⤓ .wav and NORMALIZE are all dead until
◆ RENDER has been pressed once**, and nothing on screen connected the four.

`src/ui/whyoff.js` keeps the tooltip honest in both directions — while a button
is off it names the thing that turns it on, and when it comes on it goes back to
describing what it does. One `MutationObserver` on the `disabled` attribute,
which changes a handful of times per session. Not a state machine: the panels
still own their own enable/disable logic.

Left undone deliberately: a `disabled` button is out of the tab order entirely,
so a keyboard-only reader never lands on it and hears neither title. Fixing that
means moving these to `aria-disabled` and making every handler refuse for
itself — a larger change than this round, and recorded under *Still open*.

### A sweep for the rest of the silent failures

Every finding above is the same shape — the tool doing something the author
would want to know about and keeping it to a `log()` line in a console panel
that is collapsed by default. So the last pass of this round was a sweep for
the rest of that shape: **22 fully-swallowing `catch` blocks, 26 that log
without a toast, 8 `.catch(() => {})`**.

Most are correct. The swallowing ones are almost entirely feature detection
(`ctx.letterSpacing`, `ctx.filter`, media-element teardown) where there is
genuinely nothing to say. Three were not:

- **An export that loses its sound.** Four sites — offline and real-time, video
  and sequence — where `prepareBed` throwing means the file is written *silent*
  and the only trace is `Audio bed failed … — exporting silent` in the console.
  The artefact is wrong in the way the author is least likely to notice: it
  looks right and plays back mute somewhere else, later. Now toasted. The
  export still completes, which is the correct behaviour — a clip without its
  bed beats no clip.
- **RECORD failing at `MediaRecorder`.** Both `new MediaRecorder(stream, opts)`
  and the bare-options retry can throw, and the handler logged and returned. The
  button un-greyed and nothing happened. Two lines above it, the "capture not
  supported" branch has always toasted; these two now agree.
- **A library row whose bytes never reached disk.** `setAssetPersister`'s
  failure path logged one `warn`. A browser out of room showed the row, showed
  the thumbnail, and lost the file on the next reload — first noticed as a
  bundle export missing half its media. Announced once per run of failures
  rather than once per asset, the same hysteresis as the autosave readout.

The export check is made by serving `audio/bed.js` as a module that re-exports
the real one and shadows `prepareBed` alone, so boot is untouched and only the
bed fails; the asset check rejects `backend.putAsset` for four writes and counts
the announcements.

### The fault nobody anticipated, and what build it happened on

Two things a beta needs that this repository did not have.

**There was no global error handler.** No `window.onerror`, no
`unhandledrejection` listener, anywhere. Every *individual* failure path in the
tool now says what went wrong — that is most of this round — but the one that
was never anticipated had nowhere to go. A throw on a path these suites do not
walk left the interface half-wedged and completely quiet: a button that stopped
working, and nothing to report about it. The deep suite's "no uncaught page
errors" check proves it for the paths it walks; finding the others is what a
beta *is*, and a tester can only report what the tool tells them.

`src/platform/errors.js` now catches both. Three properties, each measured:

- **Announced once per distinct fault, not once per occurrence.** A handler that
  throws on every animation frame is one problem, not sixty. Verified: 21 throws
  of the same error, 1 announcement.
- **Collapsed in the report, too.** The first version appended one line per
  occurrence, so twenty-one identical entries filled the twenty-slot list and
  pushed out the earlier, *different* fault that was the useful part. Now one
  line with a count and a last-seen time.
- **A missing image is not an exception.** Element `error` events do not bubble,
  so a non-capturing window listener never sees them — the guard in the handler
  is for the day someone adds `true` to that listener, which would deliver every
  broken image as an unexplained "something went wrong".

Nothing suppresses the default handling: the error still reaches the browser
console and still reaches Playwright's `pageerror`, so every suite that asserts
on uncaught errors goes on working unchanged.

**And there was no version anywhere.** No `package.json`, no build step, nothing
in the interface, and a boot line that read `DEAD SIGNAL STUDIO ready` with no
stamp. A bug report against a tool with no version in it is a report about an
unknown program. `src/core/version.js` holds one hand-maintained constant — a
generated stamp needs a build step, and not having one is a commitment this
repository makes everywhere else — shown in the header, in the boot line, and in
**⎘ COPY DIAGNOSTICS** on the HELP tab, which puts the build, the browser, which
platform features are actually present (WebCodecs, OffscreenCanvas, IndexedDB,
MediaRecorder, AudioContext, canvas `letterSpacing`), the secure-context state
and the session's faults on the clipboard. Clipboard only: nothing is sent
anywhere, which is the premise of the tool and has to stay true of its bug
reports.

One correction worth recording. The missing-image check originally measured the
*toast rail* and passed against a reporter that was recording the image error —
every announcement carries the same text and the rail collapses repeats into
`×N`, so "no new toast text" cannot tell absence from collapse. Two neighbouring
checks caught what it missed. It measures the fault list now, and goes red when
the listener is made capturing.

### Investigated and found NOT to be defects

- **Layout at every width from 375 to 1440.** No sideways scroll at any of them,
  nothing pushed out of clicking range, and a 400-character variable value, a
  400-character library name and a 400-character text overlay all stayed inside
  the page. The dense control panel holds up.
- **A project file that is not a project file.** Six malformed inputs — not
  JSON, an array, `{}`, `{"tabs":"nope"}`, nulls throughout, a 4000-character
  seed. Each is refused by `assertProject` before anything is touched, and the
  load handler catches it and says "Not a project file — nothing changed".
- **Every button, pressed from a cold empty project.** All 116 of them, with no
  clips, no library, no chains and nothing selected: **nothing threw** — no page
  errors, no console errors. The empty state is genuinely handled.
- **"The welcome card ignores Escape."** The first probe dispatched the key on
  `document`; the listener is on the dialog element. Focus is moved inside on
  open, so a real key press bubbles to it and closes the card. The palette and
  preset manager behave identically, and all three also close on a backdrop
  click. The probe was wrong, not the code — the same mistake as the synthetic
  `change` event earlier in this audit, and worth recording twice for that
  reason.
- **"CLEAR ALL wipes the library without confirming."** It does not confirm, and
  does not need to: it is a single undo entry, and undo restores the rows *and
  their bytes* — checked by reading the blob back after the undo, 128 bytes in
  and 128 bytes out. Recoverable beats interrogated.

---

## A gate that could not say what broke

Recorded because it is the one problem in here the audit found by *being* the
user of its own tooling.

A `ci-gate` run went red with **`smoke: 175 passed, 1 failed`** and no way to
learn which check that was. Two separate gaps, both now closed:

- **`test-studio-smoke.mjs` was the only one of the ten suites that printed a
  count and never listed its failures.** Fine locally, where the FAIL line is on
  screen; useless in CI, where the gate captures a suite's output.
- **`scripts/ci-gate.sh` echoed `tail -30` of a failing suite** — the wrong 30
  lines whenever the failure is not at the end, and a suite that finishes with two
  hundred passes never is. Every visible line in that log was a `PASS`.

The gate now greps the FAIL lines and the suites' own *Needs attention* block and
prints those first, keeping the tail underneath because a crash has no FAIL line
to grep and that is precisely when the last lines are the whole story. Verified
by breaking a check ~200 lines from the end: it now names itself in the first
screenful, where before it appeared nowhere in the log.

**The flake itself is unidentified, and is left that way rather than guessed at.**
The same commit passed on a second run, and twelve minutes of local runs — three
of them under 3× CPU oversubscription — stayed green. There is a plausible
suspect (`the preview redraws at the clip frame rate` measures over 2 s and calls
`getImageData` on every rAF tick, so under contention the measurement competes
with the thing it measures) but no evidence against it, so nothing was changed
there. A recurrence will now name itself.

**The same commit was also being gated twice.** `push: ['**']` alongside
`pull_request` ran all ten jobs on every push to a branch with a PR open: double
the CI minutes for no extra coverage, double the exposure to any flake, and the
reason one SHA in this PR's history carries both a red and a green `ci-gate`.
`push` is now scoped to the default branch, `pull_request` covers the rest, and
the concurrency group keys on the head ref so the two events can no longer both
survive to completion.

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
